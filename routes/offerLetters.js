// routes/offerLetters.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const router = express.Router();

// ONE physical folder (hard-coded as requested)
const FILE_STORAGE_PATH = "/var/www/html/documents/Recruiter/OfferLetters";

// Public URL that serves the SAME folder
const PUBLIC_BASE_URL = "https://docs.sentrifugo.com/Recruiter/OfferLetters";

// ensure folder exists
fs.mkdirSync(FILE_STORAGE_PATH, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, FILE_STORAGE_PATH);
    },
    filename(req, file, cb) {
      const { candidateId  } = req.body;
      // const safeName = String(candidateName).trim().replace(/[^\w\-]+/g, "_");
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      cb(null, `Offer_Letter_${candidateId }_${ts}.pdf`);
    },
  }),
  fileFilter(req, file, cb) {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// POST /api/offer-letters/upload
// form-data: pdfFile(file), candidateId(text), candidateName(text)
router.post("/upload", upload.single("pdfFile"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing File" });

    const publicUrl = `${PUBLIC_BASE_URL}/${req.file.filename}`;

    return res.json({
      message: "File uploaded successfully",
      file_path: req.file.path, // physical UNC path
      public_url: publicUrl,    // open in browser
      filename: req.file.filename,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Failed to upload file" });
  }
});

module.exports = router;
