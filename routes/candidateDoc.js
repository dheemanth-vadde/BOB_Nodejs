const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const router = express.Router();

// Use OS-specific path for document storage
const isWindows = process.platform === "win32";
const DOC_STORAGE_PATH = "/var/www/html/documents/Candidate";
const PUBLIC_BASE_URL = "https://docs.sentrifugo.com/Candidate";

// Ensure folder exists
if (!fs.existsSync(DOC_STORAGE_PATH)) {
  fs.mkdirSync(DOC_STORAGE_PATH, { recursive: true });
}

// Multer setup
const upload = multer({
  dest: DOC_STORAGE_PATH,
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "application/pdf", // in case Aadhaar/PAN scan is PDF
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, or PDF files allowed"), false);
    }
    cb(null, true);
  },
});

// Aadhaar/PAN upload route
// Endpoint: POST /api/uploaddoc/upload-doc
router.post("/uploaddoc", upload.single("docFile"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing document file" });

    const { candidateId } = req.body;
    if (!candidateId) {
      try {
        fs.unlinkSync(req.file.path); // clean up temp file
      } catch {}
      return res.status(400).json({ error: "Missing candidateId field" });
    }

    const extension = path.extname(req.file.originalname).toLowerCase();
    const finalName = `Doc_${candidateId}${extension}`;
    const from = req.file.path;
    const to = path.join(DOC_STORAGE_PATH, finalName);

    // overwrite if same candidate uploads again
    fs.renameSync(from, to);

    return res.json({
      message: "Document uploaded successfully",
      public_url: `${PUBLIC_BASE_URL}/${finalName}`,
      filename: finalName,
    });
  } catch (err) {
    console.error("Doc upload error:", err);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

module.exports = router;
