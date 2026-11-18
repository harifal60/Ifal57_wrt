const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const AppInfoParser = require("app-info-parser");
const fs = require("fs");
const path = require("path");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const APK_DIR = path.join(DATA_DIR, "apks");
const ICON_DIR = path.join(DATA_DIR, "icons");
const ADMIN_FILE = path.join(DATA_DIR, "admin.json");
const CATALOG_FILE = path.join(DATA_DIR, "catalog.json");
const DOWNLOAD_EVENTS_FILE = path.join(DATA_DIR, "download-events.json");

fs.mkdirSync(APK_DIR, { recursive: true });
fs.mkdirSync(ICON_DIR, { recursive: true });
if (!fs.existsSync(CATALOG_FILE)) fs.writeFileSync(CATALOG_FILE, "[]");
if (!fs.existsSync(DOWNLOAD_EVENTS_FILE)) fs.writeFileSync(DOWNLOAD_EVENTS_FILE, "[]");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-before-deploying",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, "public")));
app.use("/icons", express.static(ICON_DIR, { maxAge: "1d", immutable: true }));

const readCatalog = () => JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
const writeCatalog = data => fs.writeFileSync(CATALOG_FILE, JSON.stringify(data, null, 2));
const isAdmin = (req, res, next) =>
  req.session.admin ? next() : res.status(401).json({ error: "Silakan login sebagai admin." });

function decodeApkIcon(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  let encoded = value.trim().replace(/\s/g, "");
  const dataUri = encoded.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/i);
  if (dataUri) encoded = dataUri[2];

  let buffer;
  try {
    buffer = Buffer.from(encoded, "base64");
  } catch (_) {
    return null;
  }

  // Batasi ukuran ikon dan pastikan hasilnya benar-benar file gambar.
  if (buffer.length < 16 || buffer.length > 2 * 1024 * 1024) return null;

  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { buffer, extension: "png" };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { buffer, extension: "jpg" };
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP") {
    return { buffer, extension: "webp" };
  }
  if (buffer.toString("ascii", 0, 3) === "GIF") {
    return { buffer, extension: "gif" };
  }
  return null;
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, APK_DIR),
  filename: (_, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, Date.now() + "-" + safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (_, file, cb) =>
    cb(null, path.extname(file.originalname).toLowerCase() === ".apk")
});

app.get("/api/status", (_, res) =>
  res.json({ setupRequired: !fs.existsSync(ADMIN_FILE) })
);

app.post("/api/setup", async (req, res) => {
  if (fs.existsSync(ADMIN_FILE)) {
    return res.status(409).json({ error: "Admin sudah dibuat." });
  }
  const { username, password } = req.body;
  if (!username || !password || String(password).length < 10) {
    return res.status(400).json({ error: "Isi username dan password minimal 10 karakter." });
  }
  const hash = await bcrypt.hash(password, 12);
  fs.writeFileSync(ADMIN_FILE, JSON.stringify({ username, hash }));
  req.session.admin = username;
  res.json({ ok: true });
});

app.post("/api/login", async (req, res) => {
  if (!fs.existsSync(ADMIN_FILE)) {
    return res.status(400).json({ error: "Buat admin terlebih dahulu." });
  }
  const admin = JSON.parse(fs.readFileSync(ADMIN_FILE, "utf8"));
  if (req.body.username !== admin.username ||
      !(await bcrypt.compare(req.body.password || "", admin.hash))) {
    return res.status(401).json({ error: "Username atau password salah." });
  }
  req.session.admin = admin.username;
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) =>
  req.session.destroy(() => res.json({ ok: true }))
);
app.get("/api/me", (req, res) =>
  res.json({ admin: req.session.admin || null })
);

app.get("/api/apps", (req, res) => {
  const isAdminLoggedIn = !!req.session.admin;
  const apps = readCatalog().map(item => ({
    id: item.id,
    name: item.name,
    version: item.version,
    description: item.description,
    filename: item.filename,
    size: item.size,
    createdAt: item.createdAt,
    iconUrl: item.iconFilename
      ? `/icons/${encodeURIComponent(path.basename(item.iconFilename))}`
      : null,
    ...(isAdminLoggedIn ? { downloads: Number(item.downloads) || 0 } : {})
  }));
  res.json(apps);
});

app.get("/api/admin/stats", isAdmin, (req, res) => {
  const catalog = readCatalog();
  let events = [];
  try {
    events = JSON.parse(fs.readFileSync(DOWNLOAD_EVENTS_FILE, "utf8"));
    if (!Array.isArray(events)) events = [];
  } catch (_) {
    events = [];
  }

  const totalDownloads = catalog.reduce((sum, item) => sum + (Number(item.downloads) || 0), 0);
  const topApps = catalog
    .map(item => ({
      id: item.id,
      name: item.name,
      downloads: Number(item.downloads) || 0
    }))
    .sort((a, b) => b.downloads - a.downloads || String(a.name).localeCompare(String(b.name)))
    .slice(0, 5);

  const today = new Date();
  const daily = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
    const key = date.toISOString().slice(0, 10);
    const count = events.filter(event => String(event.date || "").slice(0, 10) === key).length;
    daily.push({
      date: key,
      label: new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" }).format(date),
      count
    });
  }

  res.json({
    appCount: catalog.length,
    totalDownloads,
    trackedDownloads: events.length,
    daily,
    topApps
  });
});

app.post("/api/upload", isAdmin, upload.single("apk"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Pilih file APK yang valid." });
  }

  const { name, version, description } = req.body;
  if (!name || !version) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Nama aplikasi dan versi wajib diisi." });
  }

  const id = Date.now().toString();
  let iconFilename = null;

  // Ekstraksi ikon bersifat opsional: jika APK tidak terbaca, upload APK tetap berhasil.
  try {
    const parser = new AppInfoParser(req.file.path);
    const info = await parser.parse();
    const extracted = decodeApkIcon(info && info.icon);

    if (extracted) {
      iconFilename = `${id}.${extracted.extension}`;
      fs.writeFileSync(path.join(ICON_DIR, iconFilename), extracted.buffer);
    } else {
      console.warn("Ikon APK tidak ditemukan atau formatnya tidak didukung:", req.file.originalname);
    }
  } catch (error) {
    console.warn("Gagal mengambil ikon APK; upload tetap dilanjutkan:", error.message);
  }

  const catalog = readCatalog();
  const item = {
    id,
    name,
    version,
    description: description || "",
    filename: req.file.filename,
    size: req.file.size,
    iconFilename,
    downloads: 0,
    createdAt: new Date().toISOString()
  };
  catalog.unshift(item);
  writeCatalog(catalog);
  res.json({ ok: true, app: item });
});

app.delete("/api/apps/:id", isAdmin, (req, res) => {
  const catalog = readCatalog();
  const item = catalog.find(x => x.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: "Aplikasi tidak ditemukan." });
  }

  const target = path.join(APK_DIR, path.basename(item.filename));
  if (fs.existsSync(target)) fs.unlinkSync(target);

  if (item.iconFilename) {
    const iconTarget = path.join(ICON_DIR, path.basename(item.iconFilename));
    if (fs.existsSync(iconTarget)) fs.unlinkSync(iconTarget);
  }

  writeCatalog(catalog.filter(x => x.id !== item.id));
  res.json({ ok: true });
});

app.get("/download/:id", (req, res) => {
  const item = readCatalog().find(x => x.id === req.params.id);
  if (!item) return res.status(404).send("APK tidak ditemukan.");

  const apkPath = path.join(APK_DIR, path.basename(item.filename));
  if (!fs.existsSync(apkPath)) {
    return res.status(404).send("File APK tidak tersedia di server.");
  }

  // Hitung unduhan hanya setelah file berhasil dikirim ke pengguna.
  res.download(apkPath, item.name + ".apk", error => {
    if (error) {
      console.error("Gagal mengirim APK:", error.message);
      if (!res.headersSent) res.status(500).send("Gagal mengunduh APK.");
      return;
    }

    const latestCatalog = readCatalog();
    const latestItem = latestCatalog.find(x => x.id === req.params.id);
    if (latestItem) {
      latestItem.downloads = (Number(latestItem.downloads) || 0) + 1;
      writeCatalog(latestCatalog);

      // Simpan waktu unduhan agar grafik harian bisa dibuat.
      try {
        let events = JSON.parse(fs.readFileSync(DOWNLOAD_EVENTS_FILE, "utf8"));
        if (!Array.isArray(events)) events = [];
        events.push({ appId: latestItem.id, appName: latestItem.name, date: new Date().toISOString() });
        fs.writeFileSync(DOWNLOAD_EVENTS_FILE, JSON.stringify(events));
      } catch (eventError) {
        console.warn("Gagal menyimpan riwayat unduhan:", eventError.message);
      }
    }
  });
});

app.listen(PORT, () => console.log(`IFAL57_WRT running on port ${PORT}`));
