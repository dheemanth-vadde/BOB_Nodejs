// routes/offerLetters.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const router = express.Router();

const FILE_STORAGE_PATH = "/var/www/html/documents/Recruiter/OfferLetters";
const PUBLIC_BASE_URL = "https://docs.sentrifugo.com/Recruiter/OfferLetters";

fs.mkdirSync(FILE_STORAGE_PATH, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, FILE_STORAGE_PATH);
    },
    filename(req, file, cb) {
      // Save with a temporary unique name first
      const tmp = `Offer_Letter_TMP_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}.pdf`;
      // expose the temp name to the route handler
      req._tmpUploadName = tmp;
      cb(null, tmp);
    },
  }),
  fileFilter(req, file, cb) {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// POST /api/offer-letters/upload
router.post("/upload", upload.single("pdfFile"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing File" });

    const { candidateId } = req.body;
    if (!candidateId) {
      // Clean up temp file if the field wasn't sent
      try { fs.unlinkSync(path.join(FILE_STORAGE_PATH, req._tmpUploadName)); } catch {}
      return res.status(400).json({ error: "Missing candidateId field" });
    }

    const finalName = `Offer_Letter_${candidateId}.pdf`;
    const from = path.join(FILE_STORAGE_PATH, req._tmpUploadName);
    const to = path.join(FILE_STORAGE_PATH, finalName);

    // If you don't want to overwrite existing, guard here:
    // if (fs.existsSync(to)) return res.status(409).json({ error: "File already exists for this candidateId" });

    fs.renameSync(from, to);

    return res.json({
      message: "File uploaded successfully",
      public_url: `${PUBLIC_BASE_URL}/${finalName}`,
      filename: finalName,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Failed to upload file" });
  }
});

module.exports = router;
