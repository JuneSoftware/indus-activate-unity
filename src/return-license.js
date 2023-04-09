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
            const unityUsername = core.getInput('unity-username', { required: true });
            const unityPassword = core.getInput('unity-password', { required: true });
            await unity.returnLicense(unityPath, unityUsername, unityPassword);
        } else {
            const usedLicence = process.env.UNITY_LICENCE;
            if (usedLicence === undefined) {
                throw new Error('Licence return failed');
            } else {
                const licence = JSON.parse(usedLicence)
                const licenceResponse = await floatingLicence.execute('set', licence.Key);
                const unityUsername = String(licence.Email)
                const unityPassword = String(licence.Password)
                await unity.returnLicense(unityPath, unityUsername, unityPassword);
                console.log(`Licence returned ${licence.Key.substring(0, 7)}-****-****-****-****`);
            }
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
