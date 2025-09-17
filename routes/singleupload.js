// routes/singleupload.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const { OpenAI } = require("openai");

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Multer storage (temp folder; auto-created)
const UPLOAD_DIR = path.join(process.cwd(), "uploads_tmp");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, UPLOAD_DIR),
    filename: (_, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const name = `resume_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (![".pdf", ".docx"].includes(ext)) {
      return cb(new Error("Unsupported file type"));
    }
    cb(null, true);
  },
});

// --- Helpers
async function extractPdfText(filePath) {
  // read file as buffer and parse with pdf-parse
  const dataBuffer = fs.readFileSync(filePath);
  const result = await pdfParse(dataBuffer).catch((err) => {
    // Handle encrypted/password PDFs explicitly
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
  // 1) direct parse
  try {
    return JSON.parse(s);
  } catch (_) {}
  // 2) find first {...} block
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const maybe = s.slice(start, end + 1);
    try {
      return JSON.parse(maybe);
    } catch (_) {}
  }
  // 3) sanitize common mistakes (backticks, trailing commas)
  const cleaned = s
    .replace(/```json|```/g, "")
    .replace(/,(\s*[}\]])/g, "$1"); // trailing commas
  try {
    return JSON.parse(cleaned);
  } catch (_) {}
  return null;
}

// --- Route
router.post("/", upload.single("resume"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname || "").toLowerCase();

  let resumeText = "";
  try {
    // Extract text
    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ path: filePath });
      resumeText = (result && result.value) || "";
    } else if (ext === ".pdf") {
      try {
        resumeText = await extractPdfText(filePath);
        if (!resumeText.trim()) {
          // retry once (some PDFs yield text after a second parse)
          resumeText = await extractPdfText(filePath);
        }
      } catch (err) {
        if (err.code === "PDF_PASSWORD") {
          return res.status(400).json({ error: "Invalid password encryption" });
        }
        throw err;
      }
    }

    if (!resumeText.trim()) {
      return res.status(400).json({ error: "Could not extract text from file" });
    }

    // Build prompt
    const prompt = `
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
`;

    // Call OpenAI (kept to your original API style)
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      temperature: 0.2,
      messages: [
        { role: "system", content: "You are a resume parsing assistant." },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    // console.log("OpenAI raw:", raw);

    const parsed = tryHardToParseJson(raw);
    if (!parsed || typeof parsed !== "object") {
      console.error("Invalid JSON from OpenAI:", raw);
      return res.status(500).json({ error: "OpenAI returned invalid JSON" });
    }

    return res.json(parsed);
  } catch (err) {
    console.error("Parsing error:", err);
    if (err.message === "Unsupported file type") {
      return res.status(400).json({ error: "Unsupported file type" });
    }
    return res.status(500).json({ error: "Failed to parse resume" });
  } finally {
    // cleanup uploaded file
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}
  }
});

module.exports = router;
