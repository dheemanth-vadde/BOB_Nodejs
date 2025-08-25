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

// ---- NO limits here
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

// Wrap to return JSON errors
router.post("/upload", uploadHtml.single("templateFile"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing templateFile" });
    const { name } = req.body || {};
    if (!name) {
      try { fs.unlinkSync(path.join(TEMPLATE_STORAGE_PATH, req._tmpUploadName)); } catch {}
      return res.status(400).json({ error: "Missing name" });
    }

    const final = `Offer_Template_${slugify(name)}_${Date.now()}.html`;
    const tmpPath = path.join(TEMPLATE_STORAGE_PATH, req._tmpUploadName);
    const finalPath = path.join(TEMPLATE_STORAGE_PATH, final);

    fs.renameSync(tmpPath, finalPath);

    // 👉 Read the HTML and print it in backend terminal
    const htmlContent = fs.readFileSync(finalPath, "utf8");
    console.log("===== Uploaded Template HTML =====");
    console.log(htmlContent);
    console.log("=================================");

    return res.json({
      message: "Template uploaded",
      id: final,
      name,
      type: "html",
      path: `${PUBLIC_BASE_URL}/${final}`,
    });
  } catch (e) {
    console.error("Template upload error:", e);
    return res.status(500).json({ error: "Failed to upload template" });
  }
});


// List + Content routes unchanged…
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

router.get("/:id/content", (req, res) => {
  const id = req.params.id;
  if (!/^[A-Za-z0-9._-]+\.html$/.test(id)) {
    return res.status(400).json({ error: "Bad template id" });
  }
  const full = path.join(TEMPLATE_STORAGE_PATH, id);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: "Template not found" });
  }
  return res.type("html").sendFile(full);
});

module.exports = router;
