const core = require('@actions/core');
const exec = require('@actions/exec');
const path = require('path');
const unity = require('./unity');
const licencePool = require('./licencePool');

const RESERVE_DURATION_MINUTES = 480;
const MAX_SEAT_ATTEMPTS = 3;

async function run() {
    try {
        const unityPath = core.getInput('unity-path') || process.env.UNITY_PATH;
        if (!unityPath) {
            throw new Error('unity path not found');
        }

        const unityUsername = core.getInput('unity-username');
        const unityPassword = core.getInput('unity-password');
        const unityAuthenticatorKey = core.getInput('unity-authenticator-key');
        const unitySerial = core.getInput('unity-serial');

        //If username, password and authenticator key is not provided as inputs then reserve a seat from the licence pool
        //Note: The pool only supports serial based licences
        if (!unityUsername && !unityPassword && !unityAuthenticatorKey) {
            await activateFromPool(unityPath);
            return;
        }

        if (unitySerial) {
            await unity.activateSerialLicense(unityPath, unityUsername, unityPassword, unitySerial);
        } else {
            await exec.exec('npm install puppeteer@"^13.x"', [], { cwd: path.join(__dirname, '..') }); // install puppeteer for current platform
            const licenseRobot = require('./license-robot');
            const licenseRequestFile = await unity.createManualActivationFile(unityPath);
            const licenseData = await licenseRobot.getPersonalLicense(licenseRequestFile, unityUsername, unityPassword, unityAuthenticatorKey);
            await unity.activateManualLicense(unityPath, licenseData);
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

async function activateFromPool(unityPath) {
    // Free seats a dead run left reserved on this runner, returning their
    // Unity-side activation while this machine still holds the licence file.
    try {
        await licencePool.sweepMachine(async seat => {
            console.log(`Returning stale licence ${String(seat.serialId).substring(0, 7)}-****-****-****-**** from this machine`);
            await unity.returnLicense(unityPath, seat.username, seat.password);
        });
    } catch (error) {
        core.warning(`Machine sweep failed (continuing): ${error.message}`);
    }

    for (let attempt = 1; attempt <= MAX_SEAT_ATTEMPTS; attempt++) {
        const licence = await licencePool.reserve(RESERVE_DURATION_MINUTES);
        if (licence === undefined || licence.id === undefined) {
            throw new Error('Licence fetch failed');
        }

        core.setSecret(JSON.stringify(licence));
        const serial = String(licence.serialId);

        let result = await unity.tryActivateSerialLicense(
            unityPath, String(licence.username), String(licence.password), serial);
        if (!result.ok) {
            console.log(`Activation failed (${result.failure}); retrying once on the same seat`);
            result = await unity.tryActivateSerialLicense(
                unityPath, String(licence.username), String(licence.password), serial);
        }

        if (result.ok) {
            core.exportVariable('UNITY_LICENCE', JSON.stringify(licence));
            console.log(`Licence fetched ${serial.substring(0, 7)}-****-****-****-****`);
            return;
        }

        core.warning(`Blocking seat ${licence.id} (serial ${serial.substring(0, 7)}-****): ${result.failure}. Free its activation in the Unity ID dashboard, then set its status back to "available" in licenses.json on the state branch.`);
        await licencePool.block(licence.id, result.failure);
    }

    throw new Error(`Could not activate any pool seat after ${MAX_SEAT_ATTEMPTS} attempts`);
}

run();
