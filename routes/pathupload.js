// routes/pathupload.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Config
const UPLOAD_DIR = path.join(process.cwd(), "uploads_tmp");
const MAX_BYTES = 20 * 1024 * 1024; // 20MB
const ALLOWED_EXTS = [".pdf", ".docx"];
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- Helpers
function safeExt(ext) {
  return ALLOWED_EXTS.includes(ext) ? ext : "";
}

function tryUnlink(p) {
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

async function extractPdfText(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const result = await pdfParse(dataBuffer).catch((err) => {
    const msg = (err && err.message) || "";
    if (/password|encrypted/i.test(msg)) {
      const e = new Error("Invalid password encryption");
      e.code = "PDF_PASSWORD";
      throw e;
    }
    throw err;
  });
  return result.text || "";
}

function tryHardToParseJson(s) {
  try { return JSON.parse(s); } catch (_) {}
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const maybe = s.slice(start, end + 1);
    try { return JSON.parse(maybe); } catch (_) {}
  }
  const cleaned = s.replace(/```json|```/g, "").replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(cleaned); } catch (_) {}
  return null;
}

function buildPrompt(resumeText) {
  return `
The following is the content of a resume:
---
${resumeText}
---
Extract and return ONLY a JSON object with these keys (string values; leave empty string if not found):

{
  "name": "",
  "dob": "",
  "gender": "",
  "email": "",
  "country": "",
  "religion": "",
  "bloodType": "",
  "maritalStatus": "",
  "domicileState": "",
  "countryOfBirth": "",
  "stateOfBirth": "",
  "townOfBirth": "",
  "communitySegment": "",
  "motherTongue": "",
  "differentlyAbled": "",
  "state10th": "",
  "skills": "",
  "currentEmployer": "",
  "currentDesignation": "",
  "totalExperience": "",
  "address": "",
  "phone": "",
  "Mobile": ""
}

Rules:
- Output MUST be valid JSON (no comments, no backticks, no trailing commas).
- Do not add any extra text before or after the JSON.
`.trim();
}

async function callOpenAI(resumeText) {
  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo", // keep same as your existing route
    temperature: 0.2,
    messages: [
      { role: "system", content: "You are a resume parsing assistant." },
      { role: "user", content: buildPrompt(resumeText) },
    ],
  });
  const raw = completion.choices?.[0]?.message?.content ?? "";
  const parsed = tryHardToParseJson(raw);
  if (!parsed || typeof parsed !== "object") {
    const err = new Error("OpenAI returned invalid JSON");
    err._raw = raw;
    throw err;
  }
  return parsed;
}

async function parseResumeFile(filePath, ext) {
  let resumeText = "";
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    resumeText = (result && result.value) || "";
  } else if (ext === ".pdf") {
    try {
      resumeText = await extractPdfText(filePath);
      if (!resumeText.trim()) {
        resumeText = await extractPdfText(filePath); // retry once
      }
    } catch (err) {
      if (err.code === "PDF_PASSWORD") {
        const e = new Error("Invalid password encryption");
        e.code = "PDF_PASSWORD";
        throw e;
      }
      throw err;
    }
  } else {
    const e = new Error("Unsupported file type");
    e.code = "UNSUPPORTED";
    throw e;
  }

  if (!resumeText.trim()) {
    const e = new Error("Could not extract text from file");
    e.code = "NO_TEXT";
    throw e;
  }

  return callOpenAI(resumeText);
}

/**
 * Download file from URL (http/https/file) into UPLOAD_DIR.
 * Returns { filePath, ext, cleanup() }
 */
async function downloadToTemp(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    const e = new Error("Invalid URL");
    e.code = "BAD_URL";
    throw e;
  }

  // Determine extension from URL path
  let ext = safeExt(path.extname(url.pathname).toLowerCase());

  if (url.protocol === "file:") {
    const localPath = url.pathname;
    const stat = fs.statSync(localPath);
    if (stat.size > MAX_BYTES) {
      const e = new Error("File too large");
      e.code = "TOO_LARGE";
      throw e;
    }
    if (!ext) ext = safeExt(path.extname(localPath).toLowerCase());
    if (!ext) {
      const e = new Error("Unsupported file type");
      e.code = "UNSUPPORTED";
      throw e;
    }
    const tmp = path.join(UPLOAD_DIR, `resume_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    fs.copyFileSync(localPath, tmp);
    return { filePath: tmp, ext, cleanup: () => tryUnlink(tmp) };
  }

  if (!/^https?:$/.test(url.protocol)) {
    const e = new Error("Only http(s) or file URLs are supported");
    e.code = "BAD_URL";
    throw e;
  }

  // HEAD to check size/content-type if available
  try {
    const head = await axios.head(urlStr, { timeout: 10000, maxRedirects: 5, validateStatus: () => true });
    const len = Number(head.headers["content-length"] || 0);
    if (len && len > MAX_BYTES) {
      const e = new Error("File too large");
      e.code = "TOO_LARGE";
      throw e;
    }
    if (!ext) {
      const ct = (head.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (ct === "application/pdf") ext = ".pdf";
      if (ct === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") ext = ".docx";
      ext = safeExt(ext);
    }
  } catch {
    // HEAD failure is fine; continue to GET.
  }

  const tmpName = `resume_${Date.now()}_${Math.random().toString(36).slice(2)}${ext || ""}`;
  const tmpPath = path.join(UPLOAD_DIR, tmpName);

  const response = await axios.get(urlStr, {
    responseType: "stream",
    timeout: 20000,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  // stream to disk with size guard
  let downloaded = 0;
  const writer = fs.createWriteStream(tmpPath);
  const stream = response.data;

  const finalize = new Promise((resolve, reject) => {
    stream.on("data", (chunk) => {
      downloaded += chunk.length;
      if (downloaded > MAX_BYTES) {
        stream.destroy(new Error("File too large"));
      }
    });
    stream.on("error", reject);
    writer.on("error", reject);
    writer.on("finish", resolve);
    stream.pipe(writer);
  });

  try {
    await finalize;
  } catch (err) {
    tryUnlink(tmpPath);
    const e = new Error(err && err.message === "File too large" ? "File too large" : "Failed to download file");
    e.code = err && err.message === "File too large" ? "TOO_LARGE" : "DL_FAIL";
    throw e;
  }

  // If ext still unknown, infer from GET Content-Type
  if (!ext) {
    const ct = (response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    let guessed = "";
    if (ct === "application/pdf") guessed = ".pdf";
    if (ct === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") guessed = ".docx";
    guessed = safeExt(guessed);
    if (guessed) {
      const renamed = `${tmpPath}${guessed}`;
      fs.renameSync(tmpPath, renamed);
      return { filePath: renamed, ext: guessed, cleanup: () => tryUnlink(renamed) };
    } else {
      tryUnlink(tmpPath);
      const e = new Error("Unsupported file type");
      e.code = "UNSUPPORTED";
      throw e;
    }
  }

  return { filePath: tmpPath, ext, cleanup: () => tryUnlink(tmpPath) };
}

// ================== ROUTE ==================
// POST /api/pathupload
// Body: { "url": "<http(s) or file:// path to .pdf/.docx>" }
// Also supports query param: /api/pathupload?url=...
router.post("/", express.json(), async (req, res) => {
  const url = (req.body && req.body.url) || (req.query && req.query.url);
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing 'url' in request" });
  }

  let temp;
  try {
    temp = await downloadToTemp(url); // { filePath, ext, cleanup }
    const parsed = await parseResumeFile(temp.filePath, temp.ext);
    return res.json(parsed);
  } catch (err) {
    console.error("Path upload error:", err);
    if (err.code === "BAD_URL") return res.status(400).json({ error: "Invalid or unsupported URL" });
    if (err.code === "TOO_LARGE") return res.status(413).json({ error: "File too large (max 20MB)" });
    if (err.code === "UNSUPPORTED") return res.status(400).json({ error: "Unsupported file type (only PDF/DOCX)" });
    if (err.code === "DL_FAIL") return res.status(502).json({ error: "Failed to download file" });
    if (err.code === "PDF_PASSWORD") return res.status(400).json({ error: "Invalid password encryption" });
    if (err.code === "NO_TEXT") return res.status(400).json({ error: "Could not extract text from file" });
    return res.status(500).json({ error: "Failed to parse resume" });
  } finally {
    if (temp && temp.cleanup) temp.cleanup();
  }
});

module.exports = router;
