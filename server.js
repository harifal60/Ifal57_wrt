const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const APK_DIR = path.join(DATA_DIR, "apks");
const ADMIN_FILE = path.join(DATA_DIR, "admin.json");
const CATALOG_FILE = path.join(DATA_DIR, "catalog.json");

fs.mkdirSync(APK_DIR, { recursive: true });
if (!fs.existsSync(CATALOG_FILE)) fs.writeFileSync(CATALOG_FILE, "[]");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-before-deploying",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));

const readCatalog = () => JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
const writeCatalog = data => fs.writeFileSync(CATALOG_FILE, JSON.stringify(data, null, 2));
const isAdmin = (req, res, next) => req.session.admin ? next() : res.status(401).json({ error: "Silakan login sebagai admin." });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, APK_DIR),
  filename: (_, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, Date.now() + "-" + safe);
  }
});
const upload = multer({
  storage, limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, path.extname(file.originalname).toLowerCase() === ".apk")
});

app.get("/api/status", (_, res) => res.json({ setupRequired: !fs.existsSync(ADMIN_FILE) }));
app.post("/api/setup", async (req, res) => {
  if (fs.existsSync(ADMIN_FILE)) return res.status(409).json({ error: "Admin sudah dibuat." });
  const { username, password } = req.body;
  if (!username || !password || String(password).length < 10) return res.status(400).json({ error: "Isi username dan password minimal 10 karakter." });
  const hash = await bcrypt.hash(password, 12);
  fs.writeFileSync(ADMIN_FILE, JSON.stringify({ username, hash }));
  req.session.admin = username;
  res.json({ ok: true });
});
app.post("/api/login", async (req, res) => {
  if (!fs.existsSync(ADMIN_FILE)) return res.status(400).json({ error: "Buat admin terlebih dahulu." });
  const admin = JSON.parse(fs.readFileSync(ADMIN_FILE, "utf8"));
  if (req.body.username !== admin.username || !(await bcrypt.compare(req.body.password || "", admin.hash)))
    return res.status(401).json({ error: "Username atau password salah." });
  req.session.admin = admin.username;
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", (req, res) => res.json({ admin: req.session.admin || null }));
app.get("/api/apps", (_, res) => res.json(readCatalog().map(({ id, name, version, description, filename, size, createdAt }) => ({ id, name, version, description, filename, size, createdAt }))));
app.post("/api/upload", isAdmin, upload.single("apk"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Pilih file APK yang valid." });
  const { name, version, description } = req.body;
  if (!name || !version) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Nama aplikasi dan versi wajib diisi." });
  }
  const catalog = readCatalog();
  const item = { id: Date.now().toString(), name, version, description: description || "", filename: req.file.filename, size: req.file.size, createdAt: new Date().toISOString() };
  catalog.unshift(item); writeCatalog(catalog);
  res.json({ ok: true, app: item });
});
app.delete("/api/apps/:id", isAdmin, (req, res) => {
  const catalog = readCatalog();
  const item = catalog.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Aplikasi tidak ditemukan." });
  const target = path.join(APK_DIR, path.basename(item.filename));
  if (fs.existsSync(target)) fs.unlinkSync(target);
  writeCatalog(catalog.filter(x => x.id !== item.id));
  res.json({ ok: true });
});
app.get("/download/:id", (req, res) => {
  const item = readCatalog().find(x => x.id === req.params.id);
  if (!item) return res.status(404).send("APK tidak ditemukan.");
  res.download(path.join(APK_DIR, path.basename(item.filename)), item.name + ".apk");
});
app.listen(PORT, () => console.log(`IFAL57_WRT running on port ${PORT}`));
