const axios = require('axios');
const core = require('@actions/core');

const baseUrl = core.getInput('audience');
const apiKey = core.getInput('apiKey')

module.exports = { reserve, release };

async function reserve(durationInMinutes) {
  const url = `${baseUrl}/reservations`;

  const headers = {
    "X-Api-Key": apiKey,
    "Content-Type": "application/json"
  };
  
  const data = { durationInMinutes };

  try {
    const response = await axios.post(url, data, { headers: headers });
    
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      throw new Error("Error: No license found.");
    } else {
      throw error;
    }
  }
}

async function release(reservationId) {
  const url = `${baseUrl}/reservations/${reservationId}`;

  const headers = {
    "X-Api-Key": apiKey
  };

  await axios.delete(url, { headers: headers });
}