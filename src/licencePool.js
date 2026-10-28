const axios = require('axios');
const core = require('@actions/core');
const os = require('os');

// Licence pool stored as licenses.json on the orphan `state` branch of this
// repo. Reserve/return are compare-and-swap updates via the GitHub Contents
// API: a PUT carries the blob sha we read, so a concurrent writer makes it
// fail and we re-read and retry.
//
// Seat lifecycle: available -> reserved -> available (released or expired),
// or reserved -> blocked when a serial fails to activate (manual unblock by
// editing licenses.json). Reservations are stamped with the runner that made
// them so the machine's next job can sweep leftovers from dead attempts.

const POOL_REPO = 'JuneSoftware/indus-activate-unity';
const POOL_BRANCH = 'state';
const POOL_FILE = 'licenses.json';

const RETRY_DELAY_MS = 5 * 1000;       // lost a compare-and-swap race
const WAIT_FOR_SEAT_MS = 30 * 1000;    // all seats taken, poll again
const RESERVE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_WRITE_ATTEMPTS = 10;

module.exports = { reserve, release, sweepMachine, block };

function api() {
    const token = core.getInput('pool-token');
    if (!token) {
        throw new Error('pool-token input is required to use the licence pool');
    }
    return axios.create({
        baseURL: `https://api.github.com/repos/${POOL_REPO}/contents/`,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });
}

function currentRunId() {
    return `${process.env.GITHUB_REPOSITORY}/${process.env.GITHUB_RUN_ID}`;
}

function currentMachine() {
    return process.env.RUNNER_NAME || os.hostname();
}

async function readPool(client) {
    const response = await client.get(POOL_FILE, { params: { ref: POOL_BRANCH } });
    const entries = JSON.parse(Buffer.from(response.data.content, 'base64').toString('utf8'));
    return { entries, sha: response.data.sha };
}

async function writePool(client, entries, sha, message) {
    await client.put(POOL_FILE, {
        message,
        content: Buffer.from(JSON.stringify(entries, null, 2)).toString('base64'),
        sha,
        branch: POOL_BRANCH
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function reserve(durationInMinutes) {
    const game = core.getInput('game');
    if (!game) {
        throw new Error('game input is required to reserve a pooled licence');
    }
    const runId = currentRunId();
    const client = api();
    const deadline = Date.now() + RESERVE_TIMEOUT_MS;

    while (Date.now() < deadline) {
        const { entries, sha } = await readPool(client);
        const now = new Date();

        // Free expired reservations (replaces the old service-side Cleanup).
        for (const entry of entries) {
            if (entry.status === 'reserved' && entry.expiresAt && new Date(entry.expiresAt) <= now) {
                console.log(`Freeing expired reservation ${entry.id} (was ${entry.reservedBy})`);
                free(entry);
            }
        }

        const seat = entries.find(v => v.game === game && v.status === 'available');
        if (!seat) {
            console.log(`No free '${game}' seat (${entries.length} total); retrying in ${WAIT_FOR_SEAT_MS / 1000}s`);
            await sleep(WAIT_FOR_SEAT_MS);
            continue;
        }

        seat.status = 'reserved';
        seat.expiresAt = new Date(now.getTime() + durationInMinutes * 60 * 1000).toISOString();
        seat.reservedBy = runId;
        // Stamp the runner so its next job can sweep this seat if we die
        // without releasing. machineRun doubles as a validity check: the
        // stamp only counts while it still matches reservedBy (an old
        // client re-reserving the seat changes reservedBy but not the
        // stamp, and the mismatch disarms the sweep).
        seat.machine = currentMachine();
        seat.machineRun = runId;

        try {
            await writePool(client, entries, sha, `reserve ${seat.id} for ${runId}`);
            return { id: seat.id, username: seat.username, password: seat.password, serialId: seat.serialId };
        } catch (error) {
            if (isCasConflict(error)) {
                console.log('Lost a reservation race; retrying');
                await sleep(RETRY_DELAY_MS);
                continue;
            }
            throw poolError(error);
        }
    }

    throw new Error(`Timed out after ${RESERVE_TIMEOUT_MS / 60000} minutes waiting for a free '${game}' licence`);
}

async function release(reservationId) {
    const runId = currentRunId();
    const client = api();

    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
        const { entries, sha } = await readPool(client);
        const seat = entries.find(v => v.id === reservationId);
        if (!seat) {
            throw new Error(`Licence ${reservationId} not found in pool`);
        }
        if (seat.status !== 'reserved' || seat.reservedBy !== runId) {
            // Expired and re-reserved by another run, or already freed - not ours to touch.
            console.log(`Licence ${reservationId} no longer held by this run; nothing to release`);
            return;
        }

        free(seat);

        try {
            await writePool(client, entries, sha, `release ${reservationId} by ${runId}`);
            return;
        } catch (error) {
            if (isCasConflict(error)) {
                await sleep(RETRY_DELAY_MS);
                continue;
            }
            throw poolError(error);
        }
    }

    throw new Error(`Could not release licence ${reservationId}: too many write conflicts`);
}

// Free seats that a previous, uncleanly-ended run left reserved on THIS
// runner. Safe because a runner processes one job at a time: a seat stamped
// with this runner by a different run cannot be in use by a live build.
// The machineRun === reservedBy check ignores stale stamps on seats that an
// old (pre-stamp) client has since re-reserved for a live build elsewhere.
// onBeforeFree(seat) runs once per seat before it is freed - used for a
// best-effort Unity-side licence return; its failure does not stop the sweep.
async function sweepMachine(onBeforeFree) {
    const runId = currentRunId();
    const machine = currentMachine();
    const client = api();
    const cleaned = new Set();

    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
        const { entries, sha } = await readPool(client);
        const stale = entries.filter(v =>
            v.status === 'reserved' &&
            v.machine === machine &&
            v.machineRun &&
            v.machineRun === v.reservedBy &&
            v.reservedBy !== runId);

        if (stale.length === 0) {
            return cleaned.size;
        }

        for (const seat of stale) {
            if (onBeforeFree && !cleaned.has(seat.id)) {
                try {
                    await onBeforeFree(seat);
                } catch (error) {
                    console.log(`Unity-side return for stale seat ${seat.id} failed (continuing): ${error.message}`);
                }
            }
            cleaned.add(seat.id);
            console.log(`Sweeping stale reservation ${seat.id} left by ${seat.reservedBy} on ${machine}`);
            free(seat);
        }

        try {
            await writePool(client, entries, sha, `machine-sweep ${stale.length} seat(s) on ${machine} by ${runId}`);
            return cleaned.size;
        } catch (error) {
            if (isCasConflict(error)) {
                await sleep(RETRY_DELAY_MS);
                continue;
            }
            throw poolError(error);
        }
    }

    console.log('Machine sweep gave up after too many write conflicts; expiry will clean up instead');
    return cleaned.size;
}

// Quarantine a seat whose serial would not activate (e.g. activation limit
// reached on Unity's licensing server). Blocked seats are skipped by every
// reserve and never expire; unblock by editing licenses.json after freeing
// the activation in the Unity ID dashboard.
async function block(reservationId, reason) {
    const runId = currentRunId();
    const client = api();

    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
        const { entries, sha } = await readPool(client);
        const seat = entries.find(v => v.id === reservationId);
        if (!seat || seat.status !== 'reserved' || seat.reservedBy !== runId) {
            console.log(`Licence ${reservationId} no longer held by this run; not blocking`);
            return;
        }

        seat.status = 'blocked';
        seat.expiresAt = null;
        seat.blockedReason = `${String(reason).slice(0, 200)} @ ${new Date().toISOString()}`;

        try {
            await writePool(client, entries, sha, `block ${reservationId} by ${runId}`);
            return;
        } catch (error) {
            if (isCasConflict(error)) {
                await sleep(RETRY_DELAY_MS);
                continue;
            }
            throw poolError(error);
        }
    }

    throw new Error(`Could not block licence ${reservationId}: too many write conflicts`);
}

function free(entry) {
    entry.status = 'available';
    entry.expiresAt = null;
    entry.reservedBy = null;
    entry.machine = null;
    entry.machineRun = null;
}

function isCasConflict(error) {
    return error.response && (error.response.status === 409 || error.response.status === 422);
}

function poolError(error) {
    if (error.response) {
        return new Error(`Licence pool request failed: HTTP ${error.response.status} ${JSON.stringify(error.response.data && error.response.data.message)}`);
    }
    return error;
}
