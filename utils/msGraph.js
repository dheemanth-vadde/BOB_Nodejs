const axios = require("axios");
const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;

async function getAppAccessToken() {
  const url = `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.set("client_id", MS_CLIENT_ID);
  params.set("client_secret", MS_CLIENT_SECRET);
  params.set("grant_type", "client_credentials");
  params.set("scope", "https://graph.microsoft.com/.default");
  const { data } = await axios.post(url, params);
  return data.access_token;
}

// Free/busy for one or more emails
async function getSchedule(emails, startISO, endISO, intervalMinutes = 30, timeZone = "Asia/Kolkata") {
  const token = await getAppAccessToken();
  const body = {
    schedules: emails,
    startTime: { dateTime: startISO, timeZone },
    endTime:   { dateTime: endISO,   timeZone },
    availabilityViewInterval: intervalMinutes
  };
  // App-only: don't use /me; anchor on any user
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(emails[0])}/calendar/getSchedule`;
  const { data } = await axios.post(url, body, { headers: { Authorization: `Bearer ${token}` }});
  return data;
}

// Create event in interviewer’s calendar
async function createEvent(interviewerEmail, payload) {
  const token = await getAppAccessToken();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(interviewerEmail)}/events`;
  const { data } = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` }});
  return data;
}

module.exports = { getSchedule, createEvent };
