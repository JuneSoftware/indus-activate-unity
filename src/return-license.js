const core = require('@actions/core');
const unity = require('./unity');
const floatingLicence = require('./floatingLicence')

async function run() {
    try {
        const unityPath = core.getInput('unity-path') || process.env.UNITY_PATH;
        if (!unityPath) {
            throw new Error('unity path not found');
        }
        if (core.getInput('unity-serial')) {
            const unityUsername = core.getInput('unity-username');
            const unityPassword = core.getInput('unity-password');
            await unity.returnLicense(unityPath, unityUsername, unityPassword);
        } else {
            const usedLicence = process.env.UNITY_LICENCE;
            if (usedLicence === undefined) {
                throw new Error('Licence return failed');
            } else {
                const licence = JSON.parse(usedLicence)
                await floatingLicence.release(licence.id);
                const unityUsername = String(licence.username)
                const unityPassword = String(licence.password)
                await unity.returnLicense(unityPath, unityUsername, unityPassword);
                console.log(`Licence returned ${licence.serialId.substring(0, 7)}-****-****-****-****`);
            }
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
