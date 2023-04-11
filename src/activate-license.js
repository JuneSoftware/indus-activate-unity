const core = require('@actions/core');
const exec = require('@actions/exec');
const path = require('path');
const unity = require('./unity');
const floatingLicence = require('./floatingLicence')

async function run() {
    try {
        const unityPath = core.getInput('unity-path') || process.env.UNITY_PATH;
        if (!unityPath) {
            throw new Error('unity path not found');
        }

        let unityUsername = core.getInput('unity-username');
        let unityPassword = core.getInput('unity-password');
        let unityAuthenticatorKey = core.getInput('unity-authenticator-key');
        let unitySerial = core.getInput('unity-serial');

        //If username, password and authenticator key is not provided as inputs then fetch them from floating licence API
        //Note: Floating licence will only support serial based licence
        if (!unityUsername && !unityPassword && !unityAuthenticatorKey) {
            const licence = await floatingLicence.reserve(240);
            if (licence === undefined || licence.id === undefined) {
                throw new Error('Licence fetch failed');
            } else {
                unityUsername = String(licence.username);
                unityPassword = String(licence.password);
                unitySerial = String(licence.serialId);

                core.exportVariable('UNITY_LICENCE', JSON.stringify(licence));
                core.setSecret(JSON.stringify(licence))
                console.log(`Licence fetched ${unitySerial.substring(0, 7)}-****-****-****-****`);
            }
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

run();

