const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
 
const router = express.Router();
 
const FILE_STORAGE_PATH = "/var/www/html/documents/Recruiter/Resumes";
const PUBLIC_BASE_URL = "https://docs.sentrifugo.com/Recruiter/Resumes";
 
fs.mkdirSync(FILE_STORAGE_PATH, { recursive: true });
 
// Whitelists
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/rtf",
  "text/rtf",
  "application/vnd.oasis.opendocument.text", // .odt
  "text/plain" // .txt
]);
 
const ALLOWED_EXT = new Set([".pdf", ".doc", ".docx", ".rtf", ".odt", ".txt"]);
 
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, FILE_STORAGE_PATH);
    },
    filename(req, file, cb) {
      // Save temp with random name first; we’ll rename after validating candidateId
      const tmpName = `Resume_TMP_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      req._tmpUploadName = tmpName;
      cb(null, tmpName);
    },
  }),
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_MIME.has(file.mimetype) || !ALLOWED_EXT.has(ext)) {
      return cb(
        new Error(
          "Only resume files are allowed: PDF, DOC, DOCX, RTF, ODT, or TXT"
        )
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});
 
router.post("/upload", upload.single("resumeFile"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing file (field name: resumeFile)" });
 
    let { candidateId } = req.body;
    if (!candidateId) {
      try { fs.unlinkSync(path.join(FILE_STORAGE_PATH, req._tmpUploadName)); } catch {}
      return res.status(400).json({ error: "Missing candidateId field" });
    }
 
    // Basic sanitize of candidateId for filename safety
    candidateId = String(candidateId).replace(/[^a-zA-Z0-9_-]/g, "");
 
    const originalExt = path.extname(req.file.originalname).toLowerCase();
    const finalName = `Resume_${candidateId}${originalExt}`;
    const from = path.join(FILE_STORAGE_PATH, req._tmpUploadName);
    const to = path.join(FILE_STORAGE_PATH, finalName);
 
    // Rename (overwrite if exists)
    fs.renameSync(from, to);
 
    return res.json({
      message: "Resume uploaded successfully",
      candidateId,
      filename: finalName,
      public_url: `${PUBLIC_BASE_URL}/${finalName}`,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size
    });
  } catch (err) {
    console.error("Resume upload error:", err);
    // Try to clean temp file if something failed after upload
    if (req?._tmpUploadName) {
      try { fs.unlinkSync(path.join(FILE_STORAGE_PATH, req._tmpUploadName)); } catch {}
    }
    const friendly = /Only resume files/.test(err?.message)
      ? err.message
      : "Failed to upload resume";
    res.status(500).json({ error: friendly });
  }
});
 
module.exports = router;