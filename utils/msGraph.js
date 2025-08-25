// utils/msGraph.js
const axios = require("axios");
const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;

/* -------- App-only token -------- */
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

/* -------- Minimal TZ maps -------- */
const WINDOWS_TZ_TO_IANA = {
  "India Standard Time": "Asia/Kolkata",
  UTC: "UTC",
};
const WINDOWS_TZ_TO_OFFSET = {
  "India Standard Time": "+05:30",
  UTC: "Z",
};

/* -------- Helpers -------- */
function wallClock(ymd, hh = 0, mm = 0, ss = 0) {
  const HH = String(hh).padStart(2, "0");
  const MM = String(mm).padStart(2, "0");
  const SS = String(ss).padStart(2, "0");
  return `${ymd}T${HH}:${MM}:${SS}`;
}
function ymdInIana(iso, ianaTz) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: ianaTz });
}

/**
 * getSchedule for a *single* local day (derived from startISO) in a Windows TZ.
 * - emails: [email]
 * - startISO/endISO: any ISO (used only to pick the local day)
 * - intervalMinutes: 5..120
 * - windowsTz: e.g., "India Standard Time"
 */
async function getSchedule(
  emails,
  startISO,
  endISO,
  intervalMinutes = 60,
  windowsTz = "India Standard Time"
) {
  if (!emails || !emails.length) throw new Error("getSchedule: emails required");

  const token = await getAppAccessToken();

  const ianaTz = WINDOWS_TZ_TO_IANA[windowsTz] || "UTC";
  const ymd = ymdInIana(startISO, ianaTz);

  const body = {
    schedules: emails,
    startTime: { dateTime: wallClock(ymd, 0, 0, 0),    timeZone: windowsTz },
    endTime:   { dateTime: wallClock(ymd, 23, 59, 59), timeZone: windowsTz },
    availabilityViewInterval: Math.max(5, Math.min(120, parseInt(intervalMinutes, 10) || 60)),
  };

  // App-only: use a concrete user, not /me
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
    emails[0]
  )}/calendar/getSchedule`;

  const { data } = await axios.post(url, body, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  return data;
}

module.exports = {
  getSchedule,
  WINDOWS_TZ_TO_IANA,
  WINDOWS_TZ_TO_OFFSET,
};
