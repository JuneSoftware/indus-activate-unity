const axios = require('axios');
const { JWT } = require('google-auth-library');
const core = require('@actions/core');

const privatekey = core.getInput('serviceAccountKey')
const audience = core.getInput('audience')

module.exports = { execute };

async function getIDToken() 
{
  try 
  {
    const privateKeyJSON = JSON.parse(privatekey);
    const jwtClient = new JWT({ email: privateKeyJSON.client_email, key: privateKeyJSON.private_key, scopes: [audience] });
    const tokenResponse = await jwtClient.authorize();
    return tokenResponse.id_token;
  } 
  catch (error) 
  {
    core.setFailed(error.message);
  }
}

async function execute(message, serialKey)
{
  try 
  {
    const idToken = await getIDToken(); //Get ID token for authorization

    const body = {
      'message': message,
      'serialKey': serialKey
    };
    const headers = {
      headers: {
        'Authorization': `bearer ${idToken}`, 
        'Content-Type': 'application/json'
      },
      timeout: 70000
    }

    const response = await axios.post(audience, body, headers); //Post the HTTP request using the ID token

    return response.data;
  }
  catch (error) 
  {
    core.setFailed(error.message);
  }
}