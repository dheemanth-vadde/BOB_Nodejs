// routes/offerTemplates.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const router = express.Router();

const TEMPLATE_STORAGE_PATH = "/var/www/html/documents/Recruiter/OfferTemplates";
const PUBLIC_BASE_URL = "https://docs.sentrifugo.com/Recruiter/OfferTemplates";

fs.mkdirSync(TEMPLATE_STORAGE_PATH, { recursive: true });

const slugify = (s) =>
  (s || "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const isValidHtmlId = (id) => /^[A-Za-z0-9._-]+\.html$/.test(id);

// ---- temp storage for upload
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, TEMPLATE_STORAGE_PATH),
  filename: (req, file, cb) => {
    const tmp = `TPL_TMP_${Date.now()}_${Math.random().toString(36).slice(2)}.html`;
    req._tmpUploadName = tmp;
    cb(null, tmp);
  },
});

const uploadHtml = multer({
  storage,
  fileFilter: (_, file, cb) => {
    const ok =
      ["text/html", "application/xhtml+xml", "application/octet-stream"].includes(file.mimetype) ||
      (file.originalname || "").toLowerCase().endsWith(".html");
    if (!ok) {
      return cb(Object.assign(new Error("Only HTML files allowed"), { statusCode: 415 }));
    }
    cb(null, true);
  },
});

// CREATE or REPLACE (delete-old + save-new-with-new-name)
router.post("/upload", uploadHtml.single("templateFile"), (req, res) => {
  const tmpPath = path.join(TEMPLATE_STORAGE_PATH, req._tmpUploadName || "");
  try {
    if (!req.file) return res.status(400).json({ error: "Missing templateFile" });

    const { name, id } = req.body || {};

    // If id is present -> REPLACE: delete old and save new with new name
    if (id) {
      if (!isValidHtmlId(id)) {
        try { fs.unlinkSync(tmpPath); } catch {}
        return res.status(400).json({ error: "Bad template id" });
      }
      const oldPath = path.join(TEMPLATE_STORAGE_PATH, id);
      if (!fs.existsSync(oldPath)) {
        try { fs.unlinkSync(tmpPath); } catch {}
        return res.status(404).json({ error: "Template not found" });
      }
      if (!name) {
        try { fs.unlinkSync(tmpPath); } catch {}
        return res.status(400).json({ error: "Missing name for replacement" });
      }

      // 1) delete old
      try { fs.unlinkSync(oldPath); } catch (e) {
        try { fs.unlinkSync(tmpPath); } catch {}
        return res.status(500).json({ error: "Failed to delete existing template" });
      }

      // 2) save new with new name (timestamped)
      const newFileName = `Offer_Template_${slugify(name)}_${Date.now()}.html`;
      const newPath = path.join(TEMPLATE_STORAGE_PATH, newFileName);
      fs.renameSync(tmpPath, newPath);

      // Log HTML
      const htmlContent = fs.readFileSync(newPath, "utf8");
      console.log("===== Replaced Template (new file) =====");
      console.log(`Old ID: ${id}`);
      console.log(`New ID: ${newFileName}`);
      console.log(htmlContent);
      console.log("========================================");

      return res.json({
        message: "Template replaced with new name",
        // return the NEW id
        id: newFileName,
        name,
        type: "html",
        path: `${PUBLIC_BASE_URL}/${newFileName}`,
        replaced: true,
        deleted_previous: true,
      });
    }

    // CREATE new (no id)
    if (!name) {
      try { fs.unlinkSync(tmpPath); } catch {}
      return res.status(400).json({ error: "Missing name" });
    }

    const final = `Offer_Template_${slugify(name)}_${Date.now()}.html`;
    const finalPath = path.join(TEMPLATE_STORAGE_PATH, final);
    fs.renameSync(tmpPath, finalPath);

    const htmlContent = fs.readFileSync(finalPath, "utf8");
    console.log("===== Uploaded Template HTML =====");
    console.log(`ID: ${final}`);
    console.log(htmlContent);
    console.log("=================================");

    return res.json({
      message: "Template uploaded",
      id: final,
      name,
      type: "html",
      path: `${PUBLIC_BASE_URL}/${final}`,
      replaced: false,
    });
  } catch (e) {
    console.error("Template upload error:", e);
    try { fs.unlinkSync(tmpPath); } catch {}
    return res.status(500).json({ error: "Failed to upload template" });
  }
});

// List templates
router.get("/", (_, res) => {
  try {
    const files = fs.readdirSync(TEMPLATE_STORAGE_PATH)
      .filter(f => f.endsWith(".html"))
      .map(f => ({
        id: f,
        name: f.replace(/^Offer_Template_|\.html$/g, ""),
        type: "html",
        path: `${PUBLIC_BASE_URL}/${f}`,
      }));
    res.json(files);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to list templates" });
  }
});

// Get template content
router.get("/:id/content", (req, res) => {
  const id = req.params.id;
  if (!isValidHtmlId(id)) {
    return res.status(400).json({ error: "Bad template id" });
  }
  const full = path.join(TEMPLATE_STORAGE_PATH, id);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: "Template not found" });
  }
  return res.type("html").sendFile(full);
});

module.exports = router;
