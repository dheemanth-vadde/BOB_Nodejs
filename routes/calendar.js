// routes/calendar.js
const express = require("express");
const { getSchedule, WINDOWS_TZ_TO_OFFSET } = require("../utils/msGraph");

const router = express.Router();

/* ---------- TZ maps (minimal) ---------- */
const IANA_TO_WINDOWS_TZ = { "Asia/Kolkata": "India Standard Time", UTC: "UTC" };

/* ---------- Helpers ---------- */
function makeZonedDate(ymd, hh, mm, tz) {
  const HH = String(hh).padStart(2, "0");
  const MM = String(mm).padStart(2, "0");
  if (tz === "Asia/Kolkata") return new Date(`${ymd}T${HH}:${MM}:00+05:30`);
  return new Date(`${ymd}T${HH}:${MM}:00Z`);
}

function ceilToInterval(d, minutes) {
  const ms = minutes * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

function toIsoWithOffset(dateTime, windowsTz) {
  const offset = WINDOWS_TZ_TO_OFFSET[windowsTz] || "Z";
  const trimmed = dateTime.split(".")[0];
  return offset === "Z" ? `${trimmed}Z` : `${trimmed}${offset}`;
}

function computeSlotsForDay({
  ymd, tz = "Asia/Kolkata", intervalMinutes = 60, busyRaw = [],
  workStartHour = 9, workEndHour = 18
}) {
  const businessStart = makeZonedDate(ymd, workStartHour, 0, tz);
  const businessEnd   = makeZonedDate(ymd, workEndHour, 0, tz);

  // If today, start from "now" rounded up
  const todayYmdInTz = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  let earliestStart = new Date(businessStart);

  if (ymd === todayYmdInTz) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date());

    const hh = parts.find(p => p.type === "hour")?.value ?? "00";
    const mm = parts.find(p => p.type === "minute")?.value ?? "00";
    const ss = parts.find(p => p.type === "second")?.value ?? "00";
    const offset = tz === "Asia/Kolkata" ? "+05:30" : "Z";
    const nowInTz = new Date(`${ymd}T${hh}:${mm}:${ss}${offset}`);

    earliestStart = ceilToInterval(new Date(Math.max(nowInTz, businessStart)), intervalMinutes);
  }

  const rangeStart = earliestStart;
  const rangeEnd = businessEnd;
  if (rangeStart >= rangeEnd) return [];

  // Normalize busy within [rangeStart, rangeEnd]
  const busy = (busyRaw || [])
    .map(b => ({ start: new Date(b.start), end: new Date(b.end) }))
    .filter(b => b.end > rangeStart && b.start < rangeEnd)
    .map(b => ({
      start: b.start < rangeStart ? new Date(rangeStart) : b.start,
      end:   b.end   > rangeEnd   ? new Date(rangeEnd)   : b.end,
    }))
    .sort((a, b) => a.start - b.start);

  // Merge overlaps
  const merged = [];
  for (const s of busy) {
    if (!merged.length || s.start > merged[merged.length - 1].end) {
      merged.push({ ...s });
    } else if (s.end > merged[merged.length - 1].end) {
      merged[merged.length - 1].end = s.end;
    }
  }

  // Free ranges
  const freeRanges = [];
  let cursor = new Date(rangeStart);
  for (const b of merged) {
    if (cursor < b.start) freeRanges.push({ start: new Date(cursor), end: new Date(b.start) });
    if (cursor < b.end) cursor = new Date(b.end);
  }
  if (cursor < rangeEnd) freeRanges.push({ start: new Date(cursor), end: new Date(rangeEnd) });

  // Discrete slots
  const ms = Math.max(5, parseInt(intervalMinutes, 10) || 60) * 60 * 1000;
  const slots = [];
  for (const fr of freeRanges) {
    let s = new Date(fr.start);
    s.setSeconds(0, 0);
    const frEnd = new Date(fr.end);
    while (s.getTime() + ms <= frEnd.getTime()) {
      const e = new Date(s.getTime() + ms);
      slots.push({ start: s.toISOString(), end: e.toISOString() });
      s = new Date(s.getTime() + ms);
    }
  }

  return slots;
}

/* ========== ROUTE: GET /api/calendar/free-busy ========== */
/**
 * Query params:
 *  - email: Outlook email (required)
 *  - date: "YYYY-MM-DD" in IST (optional; default = today IST)
 *  - tz: IANA tz (default "Asia/Kolkata")
 *  - interval: minutes per slot (default 60)
 *
 * Response:
 *  { email, date, tz, intervalMinutes, slots: [{start,end}] }
 */
router.get("/free-busy", async (req, res) => {
  try {
    const {
      email,
      date,                // preferred
      tz = "Asia/Kolkata",
      interval = "60",
    } = req.query;

    if (!email) return res.status(400).json({ error: "email is required" });
    const iv = Math.max(5, Math.min(120, parseInt(interval, 10) || 60));

    // Determine the working day in tz
    const ymd =
      date ||
      new Date().toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD

    // Call Graph getSchedule for that *local day*
    const windowsTz = IANA_TO_WINDOWS_TZ[tz] || "UTC";
    const data = await getSchedule([email], `${ymd}T00:00:00Z`, `${ymd}T23:59:59Z`, iv, windowsTz);

    // Normalize busy items to ISO with correct offset
    const items = data.value?.[0]?.scheduleItems || [];
    const busy = items.map(b => {
      const startTz = b.start.timeZone || windowsTz;
      const endTz   = b.end.timeZone   || windowsTz;
      return {
        start: toIsoWithOffset(b.start.dateTime, startTz),
        end:   toIsoWithOffset(b.end.dateTime,   endTz),
      };
    });

    const slots = computeSlotsForDay({ ymd, tz, intervalMinutes: iv, busyRaw: busy });

    return res.json({
      email,
      date: ymd,
      tz,
      intervalMinutes: iv,
      slots, // [{ start, end }] ISO instants
    });
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    console.error("free-busy error:", status, data || err.message);
    return res.status(500).json({
      error: "Failed to fetch free slots",
      status,
      details: data || err.message,
    });
  }
});

module.exports = router;
