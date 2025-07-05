const exec = require('@actions/exec');
const fs = require('fs');

module.exports = { createManualActivationFile, activateManualLicense, activateSerialLicense, returnLicense };

async function activateSerialLicense(unityPath, username, password, serial) {
    const stdout = await executeUnity(unityPath, `-batchmode -nographics -username "${username}" -password "${password}" -serial "${serial}" -quit`);
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
    } else {
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
