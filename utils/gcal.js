// utils/gcal.js  (NO DB — in-memory token store)
const { google } = require("googleapis");

// 🔒 In-memory token store (clears on server restart)
const tokenStore = {}; // { [auth0_sub]: { access_token, refresh_token, expiry_date, ... } }

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email",
} = process.env;

function getOAuth2Client() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

function getAuthUrl(state) {
  const oauth2 = getOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES.split(" "),
    state, // pass Auth0 sub
  });
}

// ---- token I/O (memory) ----
async function saveTokens(sub, tokens) {
  // merge so we don't lose existing refresh_token if Google doesn't resend it
  tokenStore[sub] = { ...(tokenStore[sub] || {}), ...tokens };
}

async function loadTokens(sub) {
  return tokenStore[sub];
}

// ---- auth client with auto-refresh ----
async function getAuthedClient(sub) {
  const row = await loadTokens(sub);
  if (!row) return null;

  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expiry_date: row.expiry_date ? Number(row.expiry_date) : undefined,
  });

  // Persist refreshed tokens
  oauth2.on("tokens", async (t) => {
    if (t.access_token || t.refresh_token) await saveTokens(sub, t);
  });

  return oauth2;
}

// ---- Google FreeBusy ----
async function getBusy(sub, email, startISO, endISO, timeZone = "Asia/Kolkata") {
  const auth = await getAuthedClient(sub);
  if (!auth) throw new Error("Google not linked for this user");

  const calendar = google.calendar({ version: "v3", auth });
  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: startISO,
      timeMax: endISO,
      timeZone,
      items: [{ id: email }],
    },
  });

  return data.calendars?.[email]?.busy || [];
}

// ---- Compute empty slots (no overlap with busy) ----
function computeEmptySlots(startISO, endISO, intervalMinutes, busyWindows, timeZone = "Asia/Kolkata") {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  const iv = Math.max(5, Math.min(120, parseInt(intervalMinutes, 10) || 30));
  const slots = [];
  const busy = busyWindows.map(b => [new Date(b.start).getTime(), new Date(b.end).getTime()]);

  for (let t = start; t + iv * 60000 <= end; t += iv * 60000) {
    const s = t;
    const e = t + iv * 60000;
    const overlaps = busy.some(([bs, be]) => Math.max(s, bs) < Math.min(e, be));
    if (!overlaps) {
      slots.push({
        start: new Date(s).toISOString(),
        end: new Date(e).toISOString(),
        timeZone,
      });
    }
  }
  return slots;
}

module.exports = { getAuthUrl, getOAuth2Client, saveTokens, getBusy, computeEmptySlots };
