const exec = require('@actions/exec');
const fs = require('fs');

module.exports = { createManualActivationFile, activateManualLicense, activateSerialLicense, tryActivateSerialLicense, returnLicense };

// Phrases in Unity's licensing log that positively identify a failed serial
// activation. Detection is deliberately conservative: anything else counts
// as success (matching the pre-v2.0.1 behaviour of not validating at all),
// so unfamiliar log phrasing can never mass-block healthy seats.
const ACTIVATION_FAILURE_PATTERNS = [
    /maximum number of activations/i,
    /too many activations/i,
    /unable to activate/i,
    /failed to activate/i,
    /activation was unsuccessful/i,
    /invalid serial/i
];

async function activateSerialLicense(unityPath, username, password, serial) {
    const stdout = await executeUnity(unityPath, `-batchmode -nographics -username "${username}" -password "${password}" -serial "${serial}" -quit`);
}

// Like activateSerialLicense, but reports positively-detected failures
// instead of silently ignoring them. Used by the licence-pool path so a
// poisoned serial can be quarantined and another seat tried.
async function tryActivateSerialLicense(unityPath, username, password, serial) {
    const stdout = await executeUnity(unityPath, `-batchmode -nographics -logFile "-" -username "${username}" -password "${password}" -serial "${serial}" -quit`);
    const failure = detectActivationFailure(stdout);
    return failure ? { ok: false, failure } : { ok: true };
}

function detectActivationFailure(stdout) {
    for (const pattern of ACTIVATION_FAILURE_PATTERNS) {
        const match = (stdout || '').match(pattern);
        if (match) {
            const line = stdout.split('\n').find(l => pattern.test(l)) || match[0];
            return line.trim().slice(0, 150);
        }
    }
    return null;
}

async function createManualActivationFile(unityPath) {
    await executeUnity(unityPath, '-batchmode -nographics -quit -logFile "-" -createManualActivationFile');
    return fs.readdirSync('./').find(path => path.endsWith('.alf'));
}

async function activateManualLicense(unityPath, licenseData) {
    fs.writeFileSync('license.ulf', licenseData);
    const stdout = await executeUnity(unityPath, `-batchmode -nographics -quit -logFile "-" -manualLicenseFile license.ulf`);
    if (!stdout.includes('Next license update check is after') && !stdout.includes('Successfully processed offline license activation request')) {
        throw new Error('Activation failed');
    }
}

async function returnLicense(unityPath, username, password) {
    await executeUnity(unityPath, `-batchmode -nographics -quit -logFile "-" -returnlicense -username "${username}" -password "${password}"`);
}

async function executeUnity(unityPath, args) {
    if (process.platform === 'linux') {
        return await execute(`xvfb-run --auto-servernum "${unityPath}" ${args}`, true);
    } else if (process.platform === 'darwin') {
        return await execute(`"${unityPath}" ${args}`, true);
    } else if (process.platform === 'win32') {
        return await execute(`cmd /c "${unityPath}" ${args}`, true);
    }
}

async function execute(command, ignoreReturnCode) {
    let stdout = '';
    await exec.exec(command, [], {
        ignoreReturnCode: ignoreReturnCode,
        listeners: { stdout: buffer => stdout += buffer.toString() }
    });
    return stdout;
}
