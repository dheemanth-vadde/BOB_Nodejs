const express = require("express");
const { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require("jwks-rsa");
const { getSchedule, createEvent } = require("../utils/msGraph");

const router = express.Router();
const { AUTH0_DOMAIN } = process.env;

const checkJwt = jwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true, rateLimit: true,
    jwksUri: `${AUTH0_DOMAIN}/.well-known/jwks.json`,
  }),
  audience: `${AUTH0_DOMAIN}/api/v2/`,
  issuer: `${AUTH0_DOMAIN}/`,
  algorithms: ["RS256"],
});

function calculateFreeSlots(startISO, endISO, busy, intervalMinutes) {
  const free = [];
  const start = new Date(startISO);
  const end = new Date(endISO);

  // Sort busy slots by start time
  busy.sort((a, b) => new Date(a.start) - new Date(b.start));

  let current = new Date(start);

  for (const b of busy) {
    const busyStart = new Date(b.start);
    if (current < busyStart) {
      free.push({ start: current.toISOString(), end: busyStart.toISOString() });
    }
    const busyEnd = new Date(b.end);
    if (current < busyEnd) current = busyEnd;
  }

  if (current < end) {
    free.push({ start: current.toISOString(), end: end.toISOString() });
  }

  return free;
}


// GET /api/calendar/free-busy?email=...&start=ISO&end=ISO&interval=30&tz=Asia/Kolkata
router.get("/free-busy", checkJwt, async (req, res) => {
  try {
    const { email, start, end, interval = "30", tz = "Asia/Kolkata" } = req.query;
    if (!email || !start || !end) return res.status(400).json({ error: "email, start, end are required" });

    const iv = Math.max(5, Math.min(120, parseInt(interval, 10) || 30));
    const data = await getSchedule([email], start, end, iv, tz);
    const busy = (data.value?.[0]?.scheduleItems || []).map(b => ({
      start: b.start.dateTime, end: b.end.dateTime
    }));

    const free = calculateFreeSlots(start, end, busy, iv);

    res.json({
      interviewer: { email },
      range: { start, end, timeZone: tz, intervalMinutes: iv },
      busy,
      free
    });
  } catch (err) {
    console.error("free-busy error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch free-busy", details: err.response?.data || err.message });
  }
});


// POST /api/calendar/schedule  { interviewerEmail, candidateEmail, subject, startISO, endISO, tz, bodyHtml, onlineMeeting }
router.post("/schedule", checkJwt, async (req, res) => {
  try {
    const {
      interviewerEmail, candidateEmail, subject = "Interview",
      startISO, endISO, tz = "Asia/Kolkata",
      bodyHtml = "Interview scheduled by recruiter.",
      onlineMeeting = true
    } = req.body;

    if (!interviewerEmail || !candidateEmail || !startISO || !endISO)
      return res.status(400).json({ error: "interviewerEmail, candidateEmail, startISO, endISO are required" });

    const payload = {
      subject,
      start: { dateTime: startISO, timeZone: tz },
      end:   { dateTime: endISO,   timeZone: tz },
      attendees: [{ emailAddress: { address: candidateEmail }, type: "required" }],
      body: { contentType: "HTML", content: bodyHtml },
      isOnlineMeeting: !!onlineMeeting,
      onlineMeetingProvider: onlineMeeting ? "teamsForBusiness" : "unknown"
    };

    const evt = await createEvent(interviewerEmail, payload);
    res.json({ message: "Interview scheduled", eventId: evt.id, joinUrl: evt.onlineMeeting?.joinUrl || null });
  } catch (err) {
    console.error("schedule error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to schedule", details: err.response?.data || err.message });
  }
});

module.exports = router;
