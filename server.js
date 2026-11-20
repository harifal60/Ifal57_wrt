const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const AppInfoParser = require("app-info-parser");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const APK_DIR = path.join(DATA_DIR, "apks");
const ICON_DIR = path.join(DATA_DIR, "icons");
const ADMIN_FILE = path.join(DATA_DIR, "admin.json");
const CATALOG_FILE = path.join(DATA_DIR, "catalog.json");
const DOWNLOAD_EVENTS_FILE = path.join(DATA_DIR, "download-events.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const PAYMENTS_FILE = path.join(DATA_DIR, "payments.json");
const TRIAL_DAYS = 7;
const LIFETIME_PRICE = 25000;

function createMailTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = String(process.env.GMAIL_APP_PASSWORD || "").replace(/\\s/g, "");
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass }
  });
}

fs.mkdirSync(APK_DIR, { recursive: true });
fs.mkdirSync(ICON_DIR, { recursive: true });
if (!fs.existsSync(CATALOG_FILE)) fs.writeFileSync(CATALOG_FILE, "[]");
if (!fs.existsSync(DOWNLOAD_EVENTS_FILE)) fs.writeFileSync(DOWNLOAD_EVENTS_FILE, "[]");
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
if (!fs.existsSync(PAYMENTS_FILE)) fs.writeFileSync(PAYMENTS_FILE, "[]");
// Cegah satu klik download dihitung berkali-kali saat browser mengulang request.
const countedDownloadIds = new Set();
const recentFallbackDownloads = new Map();

try {
  const savedEvents = JSON.parse(fs.readFileSync(DOWNLOAD_EVENTS_FILE, "utf8"));
  if (Array.isArray(savedEvents)) {
    savedEvents.forEach(event => {
      if (event && event.requestId) countedDownloadIds.add(String(event.requestId));
    });
  }
} catch (_) {}


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
const readUsers = () => JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
const writeUsers = data => fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
const readPayments = () => JSON.parse(fs.readFileSync(PAYMENTS_FILE, "utf8"));
const writePayments = data => fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(data, null, 2));
const writeCatalog = data => fs.writeFileSync(CATALOG_FILE, JSON.stringify(data, null, 2));
const isAdmin = (req, res, next) =>
  req.session.admin ? next() : res.status(401).json({ error: "Silakan login sebagai admin." });
function customerStatus(user) {
  if (!user) return null;
  const end = new Date(user.trialEndsAt).getTime();
  const activeTrial = user.plan !== "lifetime" && Number.isFinite(end) && Date.now() < end;
  return { email: user.email, plan: user.plan === "lifetime" ? "lifetime" : activeTrial ? "trial" : "expired", trialEndsAt: user.trialEndsAt, createdAt: user.createdAt, canDownload: user.plan === "lifetime" || activeTrial, deviceBound: !!user.deviceId };
}
function requestDeviceId(req) {
  return String(req.get("X-Device-ID") || req.body?.deviceId || "").trim().slice(0, 200);
}
function validDeviceId(value) {
  return typeof value === "string" && value.length >= 12 && value.length <= 200 && /^[a-zA-Z0-9._:-]+$/.test(value);
}
function deviceMismatch(user, deviceId) {
  return !!(user.deviceId && user.deviceId !== deviceId);
}
function requireCustomer(req, res, next) {
  // Admin yang sudah login boleh mengunduh APK dari katalog tanpa akun pelanggan.
  // Aturan trial, Premium Lifetime, dan ikatan perangkat tetap berlaku untuk pelanggan biasa.
  if (req.session.admin) {
    req.isAdminDownload = true;
    return next();
  }
  if (!req.session.userId) return res.redirect("/?login=1");
  const user = readUsers().find(item => item.id === req.session.userId);
  if (!user) { req.session.userId = null; return res.redirect("/?login=1"); }
  if (!user.deviceId || !req.session.deviceId || deviceMismatch(user, req.session.deviceId)) return res.status(403).send("Perangkat tidak cocok dengan lisensi akun ini.");
  if (!customerStatus(user).canDownload) return res.redirect("/?trial=expired");
  req.customer = user;
  next();
}

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

// Akun pelanggan terpisah dari akun admin. Trial dimulai saat registrasi pertama.
app.post("/api/customer/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const deviceId = requestDeviceId(req);
  if (!validDeviceId(deviceId)) return res.status(400).json({ error: "ID perangkat tidak terbaca. Tutup lalu buka kembali aplikasi." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Masukkan alamat email yang valid." });
  if (password.length < 10) return res.status(400).json({ error: "Password minimal 10 karakter." });
  const users = readUsers();
  if (users.some(user => user.email === email)) return res.status(409).json({ error: "Email sudah terdaftar. Silakan login." });
  const now = Date.now();
  const user = { id: crypto.randomUUID(), email, hash: await bcrypt.hash(password, 12), createdAt: new Date(now).toISOString(), trialEndsAt: new Date(now + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(), plan: "trial", deviceId, deviceBoundAt: new Date(now).toISOString() };
  users.push(user); writeUsers(users);
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  req.session.deviceId = deviceId;
  res.json({ ok: true, account: customerStatus(user) });
});

app.post("/api/customer/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const deviceId = requestDeviceId(req);
  if (!validDeviceId(deviceId)) return res.status(400).json({ error: "ID perangkat tidak terbaca. Tutup lalu buka kembali aplikasi." });
  const users = readUsers();
  const user = users.find(item => item.email === email);
  if (!user || !(await bcrypt.compare(password, user.hash))) return res.status(401).json({ error: "Email atau password salah." });
  if (deviceMismatch(user, deviceId)) return res.status(403).json({ error: "Akun ini sudah terikat ke perangkat lain. Hubungi admin untuk reset atau pindah perangkat." });
  // Akun lama yang belum memiliki ikatan perangkat akan dikunci ke perangkat saat login berikutnya.
  if (!user.deviceId) { user.deviceId = deviceId; user.deviceBoundAt = new Date().toISOString(); writeUsers(users); }
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  req.session.deviceId = deviceId;
  res.json({ ok: true, account: customerStatus(user) });
});

// Reset password pelanggan melalui tautan email sekali pakai (berlaku 30 menit).
app.post("/api/customer/forgot-password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Masukkan alamat email yang valid." });
  }

  const genericMessage = "Jika email terdaftar, tautan reset password akan dikirim. Periksa kotak masuk dan folder spam.";
  const users = readUsers();
  const user = users.find(item => item.email === email);
  if (!user) return res.json({ ok: true, message: genericMessage });

  const transporter = createMailTransporter();
  if (!transporter) {
    console.error("Reset password belum dikonfigurasi: GMAIL_USER atau GMAIL_APP_PASSWORD kosong.");
    return res.status(503).json({ error: "Layanan email belum siap. Hubungi admin aplikasi." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  user.resetTokenHash = crypto.createHash("sha256").update(token).digest("hex");
  user.resetExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  writeUsers(users);

  const appUrl = String(process.env.APP_URL || "").replace(/\/$/, "");
  if (!appUrl || !appUrl.startsWith("https://")) {
    delete user.resetTokenHash;
    delete user.resetExpiresAt;
    writeUsers(users);
    return res.status(503).json({ error: "Alamat aplikasi (APP_URL) belum dikonfigurasi dengan benar." });
  }

  const resetUrl = `${appUrl}/?reset=${encodeURIComponent(token)}`;
  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: user.email,
      subject: "Reset password IFAL57_WRT",
      text: `Kami menerima permintaan untuk mengganti password akun IFAL57_WRT. Buka tautan ini dalam 30 menit:\n\n${resetUrl}\n\nJika bukan kamu yang meminta, abaikan email ini.`,
      html: `<p>Kami menerima permintaan untuk mengganti password akun IFAL57_WRT.</p><p><a href="${resetUrl}">Buat password baru</a></p><p>Tautan berlaku selama 30 menit. Jika bukan kamu yang meminta, abaikan email ini.</p>`
    });
  } catch (error) {
    delete user.resetTokenHash;
    delete user.resetExpiresAt;
    writeUsers(users);
    console.error("Gagal mengirim email reset password:", error.message);
    return res.status(502).json({ error: "Email reset gagal dikirim. Periksa pengaturan Gmail admin." });
  }

  res.json({ ok: true, message: genericMessage });
});

app.post("/api/customer/reset-password", async (req, res) => {
  const token = String(req.body.token || "");
  const password = String(req.body.password || "");
  if (!token || token.length > 200) return res.status(400).json({ error: "Tautan reset tidak valid atau sudah kedaluwarsa." });
  if (password.length < 10) return res.status(400).json({ error: "Password baru minimal 10 karakter." });

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const users = readUsers();
  const user = users.find(item =>
    item.resetTokenHash === tokenHash &&
    item.resetExpiresAt &&
    new Date(item.resetExpiresAt).getTime() > Date.now()
  );
  if (!user) return res.status(400).json({ error: "Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru." });

  user.hash = await bcrypt.hash(password, 12);
  delete user.resetTokenHash;
  delete user.resetExpiresAt;
  writeUsers(users);
  res.json({ ok: true, message: "Password berhasil diganti. Silakan login dengan password baru." });
});

// Pembayaran Lifetime manual QRIS Rp25.000: pelanggan membuat permintaan, admin memverifikasi.
app.get("/api/customer/payment-request", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Login terlebih dahulu." });
  const user = readUsers().find(item => item.id === req.session.userId);
  if (!user) return res.status(401).json({ error: "Akun tidak ditemukan." });
  const payments = readPayments().filter(item => item.userId === user.id);
  res.json({ price: LIFETIME_PRICE, latest: payments.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null });
});
app.post("/api/customer/payment-request", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Login terlebih dahulu." });
  const users = readUsers();
  const user = users.find(item => item.id === req.session.userId);
  if (!user) return res.status(401).json({ error: "Akun tidak ditemukan." });
  if (user.plan === "lifetime") return res.status(409).json({ error: "Akun sudah Lifetime." });
  const payments = readPayments();
  const pending = payments.find(item => item.userId === user.id && item.status === "pending");
  if (pending) return res.json({ ok: true, payment: pending });
  if (!user.deviceId || !req.session.deviceId || deviceMismatch(user, req.session.deviceId)) return res.status(403).json({ error: "Perangkat tidak cocok dengan lisensi akun." });
  const payment = { id: crypto.randomUUID(), userId: user.id, email: user.email, deviceId: user.deviceId, amount: LIFETIME_PRICE, status: "pending", createdAt: new Date().toISOString() };
  payments.push(payment); writePayments(payments);
  res.json({ ok: true, payment });
});
app.get("/api/admin/users", isAdmin, (req, res) => {
  const users = readUsers().map(user => ({
    id: user.id,
    email: user.email,
    plan: customerStatus(user).plan,
    trialEndsAt: user.trialEndsAt || null,
    createdAt: user.createdAt || null,
    deviceId: user.deviceId || null,
    deviceBoundAt: user.deviceBoundAt || null
  })).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  res.json({ users, total: users.length });
});

app.get("/api/admin/payments", isAdmin, (req, res) => res.json({ payments: readPayments().sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }));
app.post("/api/admin/payments/:id/approve", isAdmin, (req, res) => {
  const payments = readPayments();
  const payment = payments.find(item => item.id === req.params.id);
  if (!payment) return res.status(404).json({ error: "Permintaan pembayaran tidak ditemukan." });
  if (payment.status === "approved") return res.json({ ok: true, payment });
  const users = readUsers();
  const user = users.find(item => item.id === payment.userId);
  if (!user) return res.status(404).json({ error: "User pembayaran tidak ditemukan." });
  user.plan = "lifetime"; user.lifetimeActivatedAt = new Date().toISOString();
  payment.status = "approved"; payment.approvedAt = new Date().toISOString(); payment.approvedBy = req.session.admin;
  payment.deviceId = user.deviceId || payment.deviceId || null;
  writeUsers(users); writePayments(payments);
  res.json({ ok: true, payment, account: customerStatus(user) });
});

app.post("/api/admin/users/:id/reset-device", isAdmin, (req, res) => {
  const users = readUsers();
  const user = users.find(item => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "Akun tidak ditemukan." });
  const previousDeviceId = user.deviceId || null;
  delete user.deviceId;
  delete user.deviceBoundAt;
  writeUsers(users);
  // Sesi lama tidak lagi dapat mengunduh; pemilik harus login ulang untuk mengikat perangkat baru.
  res.json({ ok: true, email: user.email, previousDeviceId });
});

app.post("/api/customer/logout", (req, res) => {
  req.session.userId = null;
  req.session.deviceId = null;
  res.json({ ok: true });
});

app.get("/api/customer/me", (req, res) => {
  const user = req.session.userId ? readUsers().find(item => item.id === req.session.userId) : null;
  if (user && (!user.deviceId || !req.session.deviceId || deviceMismatch(user, req.session.deviceId))) {
    req.session.userId = null; req.session.deviceId = null;
    return res.status(403).json({ error: "Sesi perangkat tidak cocok. Silakan login kembali." });
  }
  res.json({ account: customerStatus(user) });
});

app.get("/api/customer/history", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Login terlebih dahulu." });
  let events = [];
  try {
    events = JSON.parse(fs.readFileSync(DOWNLOAD_EVENTS_FILE, "utf8"));
    if (!Array.isArray(events)) events = [];
  } catch (_) {}
  const history = events
    .filter(event => event && event.userId === req.session.userId)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 20)
    .map(event => ({ appName: event.appName, date: event.date }));
  res.json({ history });
});

app.post("/api/logout", (req, res) =>
  req.session.destroy(() => res.json({ ok: true }))
);
app.get("/api/me", (req, res) =>
  res.json({ admin: req.session.admin || null })
);

app.get("/api/apps", (req, res) => {
  const isAdminLoggedIn = !!req.session.admin;
  const apps = readCatalog()
    .slice()
    .sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "id", {
        sensitivity: "base",
        numeric: true
      })
    )
    .map(item => ({
    id: item.id,
    name: item.name,
    version: item.version,
    description: item.description,
    filename: item.filename,
    size: item.size,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || null,
    isUpdate: !!(item.updatedAt && Date.now() - new Date(item.updatedAt).getTime() <= 14 * 24 * 60 * 60 * 1000),
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

app.get("/api/admin/history", isAdmin, (req, res) => {
  let events = [];
  try {
    events = JSON.parse(fs.readFileSync(DOWNLOAD_EVENTS_FILE, "utf8"));
    if (!Array.isArray(events)) events = [];
  } catch (_) {
    events = [];
  }

  const requested = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 50;
  const history = events
    .filter(event => event && event.date)
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit)
    .map(event => ({
      appId: String(event.appId || ""),
      appName: String(event.appName || "Aplikasi"),
      date: event.date
    }));

  res.json({ total: events.length, history });
});

app.post("/api/upload", isAdmin, upload.single("apk"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Pilih file APK yang valid." });
  }

  const name = String(req.body.name || "").trim();
  const version = String(req.body.version || "").trim();
  const description = String(req.body.description || "").trim();

  if (!name || !version) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Nama aplikasi dan versi wajib diisi." });
  }

  const catalog = readCatalog();
  const normalizedName = name.toLocaleLowerCase("id");
  const existingIndex = catalog.findIndex(item =>
    String(item.name || "").trim().toLocaleLowerCase("id") === normalizedName
  );
  const existing = existingIndex >= 0 ? catalog[existingIndex] : null;
  const isVersionChange = !!(existing && String(existing.version || "") !== version);

  const uploadId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  let iconFilename = null;

  // Ekstraksi ikon bersifat opsional: jika APK tidak terbaca, upload APK tetap berhasil.
  try {
    const parser = new AppInfoParser(req.file.path);
    const info = await parser.parse();
    const extracted = decodeApkIcon(info && info.icon);

    if (extracted) {
      iconFilename = `${uploadId}.${extracted.extension}`;
      fs.writeFileSync(path.join(ICON_DIR, iconFilename), extracted.buffer);
    } else {
      console.warn("Ikon APK tidak ditemukan atau formatnya tidak didukung:", req.file.originalname);
    }
  } catch (error) {
    console.warn("Gagal mengambil ikon APK; upload tetap dilanjutkan:", error.message);
  }

  const now = new Date().toISOString();
  const item = existing
    ? {
        ...existing,
        name,
        version,
        description,
        filename: req.file.filename,
        size: req.file.size,
        iconFilename,
        downloads: Number(existing.downloads) || 0,
        updatedAt: isVersionChange ? now : (existing.updatedAt || null)
      }
    : {
        id: uploadId,
        name,
        version,
        description,
        filename: req.file.filename,
        size: req.file.size,
        iconFilename,
        downloads: 0,
        createdAt: now,
        updatedAt: null
      };

  if (existing) {
    catalog[existingIndex] = item;
  } else {
    catalog.unshift(item);
  }

  writeCatalog(catalog);

  // Hapus file APK dan ikon versi lama setelah katalog berhasil diperbarui.
  if (existing) {
    const oldApk = path.join(APK_DIR, path.basename(existing.filename || ""));
    if (existing.filename && oldApk !== req.file.path && fs.existsSync(oldApk)) {
      try { fs.unlinkSync(oldApk); } catch (error) {
        console.warn("File APK versi lama tidak bisa dihapus:", error.message);
      }
    }

    if (existing.iconFilename && existing.iconFilename !== iconFilename) {
      const oldIcon = path.join(ICON_DIR, path.basename(existing.iconFilename));
      if (fs.existsSync(oldIcon)) {
        try { fs.unlinkSync(oldIcon); } catch (error) {
          console.warn("Ikon versi lama tidak bisa dihapus:", error.message);
        }
      }
    }
  }

  res.json({ ok: true, updated: !!existing, versionChanged: isVersionChange, app: item });
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

app.get("/download/:id", requireCustomer, (req, res) => {
  const item = readCatalog().find(x => x.id === req.params.id);
  if (!item) return res.status(404).send("APK tidak ditemukan.");

  const apkPath = path.join(APK_DIR, path.basename(item.filename));
  if (!fs.existsSync(apkPath)) {
    return res.status(404).send("File APK tidak tersedia di server.");
  }

  // ID dibuat oleh tombol Unduh di browser. Request ulang dengan ID sama
  // tetap mengirim file, tetapi tidak menambah statistik untuk kedua kalinya.
  const suppliedId = String(req.query.downloadId || "").slice(0, 100);
  const requestId = suppliedId && /^[a-zA-Z0-9_-]{8,100}$/.test(suppliedId)
    ? suppliedId
    : null;

  let shouldCount = false;
  let fallbackKey = null;

  if (requestId) {
    if (!countedDownloadIds.has(requestId)) {
      countedDownloadIds.add(requestId);
      shouldCount = true;
    }
  } else {
    // Kompatibilitas untuk link lama: deduplikasi singkat per sesi dan aplikasi.
    fallbackKey = `${req.sessionID || req.ip}:${item.id}`;
    const now = Date.now();
    const previous = recentFallbackDownloads.get(fallbackKey) || 0;
    if (now - previous > 3000) {
      recentFallbackDownloads.set(fallbackKey, now);
      shouldCount = true;
    }
  }

  res.download(apkPath, item.name + ".apk", error => {
    if (error) {
      console.error("Gagal mengirim APK:", error.message);
      if (shouldCount && requestId) countedDownloadIds.delete(requestId);
      if (!res.headersSent) res.status(500).send("Gagal mengunduh APK.");
      return;
    }

    if (!shouldCount) return;

    const latestCatalog = readCatalog();
    const latestItem = latestCatalog.find(x => x.id === req.params.id);
    if (!latestItem) return;

    latestItem.downloads = (Number(latestItem.downloads) || 0) + 1;
    writeCatalog(latestCatalog);

    try {
      let events = JSON.parse(fs.readFileSync(DOWNLOAD_EVENTS_FILE, "utf8"));
      if (!Array.isArray(events)) events = [];

      // Cek sekali lagi sebelum menyimpan untuk menghindari duplikasi.
      if (requestId && events.some(event => event && event.requestId === requestId)) return;

      events.push({
        appId: latestItem.id,
        appName: latestItem.name,
        date: new Date().toISOString(),
        ...(req.session.userId ? { userId: req.session.userId } : {}),
        ...(requestId ? { requestId } : {})
      });
      fs.writeFileSync(DOWNLOAD_EVENTS_FILE, JSON.stringify(events));
    } catch (eventError) {
      console.warn("Gagal menyimpan riwayat unduhan:", eventError.message);
    }
  });
});

app.listen(PORT, () => console.log(`IFAL57_WRT running on port ${PORT}`));
