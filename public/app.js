/* IFAL57_WRT Premium 2.0 — catalog and admin interactions */
const $ = (selector) => document.querySelector(selector);
const dialog = $("#adminDialog");

let setupRequired = false;
let loggedIn = false;
let catalogItems = [];
let customerAccount = null;
let customerMode = "login";
const userDialog = $("#userDialog");

const iconThemes = [
  ["#55b6e8", "#216c9e"],
  ["#61b8c5", "#287a8b"],
  ["#729bd0", "#345f9c"],
  ["#7aa9b7", "#386e83"],
  ["#9ab8d6", "#55799e"]
];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function appIcon(name) {
  const value = String(name || "").trim();
  const lower = value.toLowerCase();
  const shortcuts = [
    [/clean|booster|clear/, "✦"],
    [/launcher|home|atv/, "▦"],
    [/tv|iptv|stream/, "▣"],
    [/player|video|movie/, "▶"],
    [/browser|web|internet/, "◎"],
    [/file|manager|explorer/, "▤"],
    [/music|audio|sound/, "♫"],
    [/setting|tool|utility/, "⚙"]
  ];
  const match = shortcuts.find(([pattern]) => pattern.test(lower));
  const symbol = match ? match[1] : (value.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "APK");
  let hash = 0;
  for (const char of lower) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const colors = iconThemes[hash % iconThemes.length];
  return { symbol, background: colors[0], accent: colors[1] };
}

function formatSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "Ukuran —";
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function getNativeDeviceId() {
  try {
    if (window.IFALDevice && typeof window.IFALDevice.getDeviceId === "function") {
      return String(window.IFALDevice.getDeviceId() || "").trim();
    }
  } catch (_) {}
  return "";
}

function isNativeAppClient() {
  return !!getNativeDeviceId() || /IFAL57AndroidApp/i.test(navigator.userAgent || "");
}

function getDeviceId() {
  // Di aplikasi Android TV, ID berasal dari ANDROID_ID melalui bridge native.
  const nativeId = getNativeDeviceId();
  if (nativeId) return nativeId;

  // Untuk browser biasa, gunakan ID instalasi persisten.
  const key = "ifal57_device_id_v1";
  let id = "";
  try { id = localStorage.getItem(key) || ""; } catch (_) {}
  if (!/^[a-zA-Z0-9._:-]{12,200}$/.test(id)) {
    id = "web-" + (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try { localStorage.setItem(key, id); } catch (_) {}
  }
  return id;
}

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const nativeApp = isNativeAppClient();
  const deviceId = nativeApp ? getNativeDeviceId() : getDeviceId();

  // Jangan diam-diam mengirim ID browser sebagai ID aplikasi Android.
  if (nativeApp && !deviceId) {
    throw new Error("ID perangkat Android tidak terbaca. Tutup lalu buka kembali aplikasi IFAL57_WRT.");
  }
  headers.set("X-Device-ID", deviceId);
  if (nativeApp) headers.set("X-IFAL-Client", "android-app");
  else headers.delete("X-IFAL-Client");

  const response = await fetch(url, { ...options, headers });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch (_) {}
  if (!response.ok) {
    throw new Error(data.error || `Permintaan gagal (HTTP ${response.status}).`);
  }
  return data;
}

function setMessage(message, type = "info") {
  const node = $("#message");
  if (!node) return;
  node.textContent = message;
  node.className = `message ${type}`;
}

function ensureAdminDashboard() {
  if ($("#adminDashboard")) return;
  const dashboard = document.createElement("section");
  dashboard.id = "adminDashboard";
  dashboard.className = "admin-dashboard";
  dashboard.hidden = true;
  dashboard.innerHTML = `
    <div class="popup-admin-brand"><div><span class="dashboard-kicker">IFAL-WRT · ADMIN PANEL</span><h3>Dashboard Admin</h3><p>Kelola aplikasi dan permintaan premium.</p></div><button type="button" class="dashboard-refresh" id="refreshAdminStats" aria-label="Refresh statistik">↻</button></div>
    <div class="admin-shortcuts">
      <button type="button" class="admin-shortcut upload-shortcut" data-admin-action="upload"><span class="shortcut-icon">⇧</span><strong>Upload APK</strong><small>Unggah aplikasi terbaru</small><span class="shortcut-arrow">›</span></button>
      <button type="button" class="admin-shortcut premium-shortcut" data-admin-action="premium"><span class="shortcut-icon">♛</span><strong>Permintaan Premium</strong><small>Kelola permintaan pengguna</small><span class="shortcut-arrow">›</span></button>
    </div>
    <div class="stats-heading"><h4>Statistik Singkat</h4></div>
    <div class="dashboard-cards" id="dashboardCards"></div>
    <details class="admin-more"><summary>Analitik unduhan</summary>
      <div class="dashboard-panel"><div class="dashboard-panel-title"><strong>Unduhan 7 hari terakhir</strong><span>Harian</span></div><div class="dashboard-chart" id="dashboardChart"></div></div>
      <div class="dashboard-panel"><div class="dashboard-panel-title"><strong>Aplikasi terpopuler</strong><span>Top 5</span></div><div class="dashboard-ranking" id="dashboardRanking"></div></div>
    </details>
    <details class="admin-more" id="adminUsersPanel"><summary>Daftar Pengguna & Device ID <button type="button" id="refreshUsers" class="dashboard-refresh">Refresh</button></summary><div id="registeredUsers" class="download-history"></div></details>
    <details class="admin-more" id="adminPaymentsPanel"><summary>Permintaan Premium 30 Hari <button type="button" id="refreshPayments" class="dashboard-refresh">Refresh</button></summary><div id="paymentRequests" class="download-history"></div></details>
    <div id="adminUploadArea" class="admin-upload-area" hidden></div>`;
  const intro = $("#adminIntro");
  const uploadForm = $("#uploadForm");
  if (intro && uploadForm) {
    uploadForm.parentNode.insertBefore(dashboard, uploadForm);
    dashboard.querySelector("#adminUploadArea").appendChild(uploadForm);
  } else if (uploadForm) {
    uploadForm.insertAdjacentElement("beforebegin", dashboard);
    dashboard.querySelector("#adminUploadArea").appendChild(uploadForm);
  }
}

function renderAdminStats(stats) {
  const cards = $("#dashboardCards");
  const chart = $("#dashboardChart");
  const ranking = $("#dashboardRanking");
  if (!cards || !chart || !ranking) return;

  cards.innerHTML = `
    <div class="dashboard-stat"><span>Total APK</span><strong>${Number(stats.appCount || 0).toLocaleString("id-ID")}</strong></div>
    <div class="dashboard-stat"><span>User Premium</span><strong id="premiumUserCount">—</strong></div>
    <div class="dashboard-stat"><span>Total Unduhan</span><strong>${Number(stats.totalDownloads || 0).toLocaleString("id-ID")}</strong></div>`;

  const days = Array.isArray(stats.daily) ? stats.daily : [];
  const max = Math.max(1, ...days.map(day => Number(day.count) || 0));
  chart.innerHTML = days.map(day => {
    const count = Number(day.count) || 0;
    const height = Math.max(5, Math.round((count / max) * 100));
    return `<div class="chart-column" title="${esc(day.label)}: ${count} unduhan">
      <strong>${count}</strong>
      <div class="chart-track"><i style="height:${height}%"></i></div>
      <span>${esc(day.label)}</span>
    </div>`;
  }).join("");

  const apps = Array.isArray(stats.topApps) ? stats.topApps : [];
  ranking.innerHTML = apps.length ? apps.map((item, index) => `
    <div class="ranking-row">
      <span class="ranking-number">${index + 1}</span>
      <strong>${esc(item.name || "Aplikasi")}</strong>
      <span>${Number(item.downloads || 0).toLocaleString("id-ID")}x</span>
    </div>`).join("") : '<p class="dashboard-empty">Belum ada aplikasi.</p>';
}

async function loadAdminStats() {
  ensureAdminDashboard();
  const dashboard = $("#adminDashboard");
  if (!dashboard) return;
  dashboard.hidden = false;
  const chart = $("#dashboardChart");
  if (chart) chart.innerHTML = '<p class="dashboard-empty">Memuat statistik...</p>';
  try {
    const stats = await request("/api/admin/stats", { cache: "no-store" });
    renderAdminStats(stats);
    await loadRegisteredUsers();
    await loadPaymentRequests();
  } catch (error) {
    if (chart) chart.innerHTML = `<p class="dashboard-empty">${esc(error.message || "Statistik belum bisa dimuat.")}</p>`;
  }
}


async function loadRegisteredUsers() {
  const container = $("#registeredUsers"); if (!container) return;
  container.innerHTML = '<p class="dashboard-empty">Memuat daftar pengguna...</p>';
  try {
    const data = await request("/api/admin/users", { cache: "no-store" });
    const users = Array.isArray(data.users) ? data.users : [];
    const premiumCount = users.filter(user => user.plan === "lifetime" || user.plan === "premium").length;
    const premiumNode = $("#premiumUserCount");
    if (premiumNode) premiumNode.textContent = premiumCount.toLocaleString("id-ID");
    if (!users.length) { container.innerHTML = '<p class="dashboard-empty">Belum ada pengguna terdaftar.</p>'; return; }
    container.innerHTML = users.map(user => {
      const plan = user.plan === "lifetime" ? "Premium lama (Lifetime)" : user.plan === "premium" ? "Premium 30 hari" : user.plan === "trial" ? "Trial aktif" : "Trial berakhir";
      const created = user.createdAt ? new Date(user.createdAt).toLocaleString("id-ID") : "—";
      const appAccess = user.appAccessPending
        ? `<br><span class="history-status">Menunggu persetujuan login aplikasi</span><br><small>Device ID aplikasi: ${esc(user.appAccessDeviceId || "—")}</small>`
        : user.appAccessApproved ? '<br><span class="history-status">Login aplikasi disetujui</span>' : "";
      const approveButton = user.appAccessPending ? `<button type="button" class="primary" data-approve-app-access="${esc(user.id)}">Setujui login aplikasi</button>` : "";
      return `<div class="history-row"><div class="history-info"><strong>${esc(user.email)}</strong><small>${esc(plan)} · Daftar: ${esc(created)}<br>Device ID: ${esc(user.deviceId || user.browserDeviceId || "Belum terikat")}${appAccess}</small></div><div class="user-admin-actions">${approveButton}<button type="button" class="text-button" data-reset-device="${esc(user.id)}">Reset perangkat</button><button type="button" class="user-delete-icon" data-delete-user="${esc(user.id)}" aria-label="Hapus akun" title="Hapus akun"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></div></div>`;
    }).join("");
  } catch (error) { container.innerHTML = `<p class="dashboard-empty">${esc(error.message || "Daftar pengguna tidak dapat dimuat.")}</p>`; }
}

async function loadPaymentRequests() {
  const container = $("#paymentRequests"); if (!container) return;
  container.innerHTML = '<p class="dashboard-empty">Memuat permintaan pembayaran...</p>';
  try {
    const data = await request("/api/admin/payments", { cache: "no-store" });
    const payments = Array.isArray(data.payments) ? data.payments : [];
    const pending = payments.filter(p => p.status === "pending");
    if (!payments.length) { container.innerHTML = '<p class="dashboard-empty">Belum ada permintaan pembayaran.</p>'; return; }
    container.innerHTML = payments.map(p => `<div class="history-row"><div class="history-info"><strong>${esc(p.email)}</strong><small>Rp${Number(p.amount || 25000).toLocaleString("id-ID")} · ${esc(new Date(p.createdAt).toLocaleString("id-ID"))}<br>Device ID: ${esc(p.deviceId || "Belum tercatat")}</small></div><span class="history-status">${p.status === "approved" ? "Premium 30 hari aktif" : "Menunggu"}</span>${p.status === "pending" ? `<button type="button" class="primary" data-approve-payment="${esc(p.id)}">Aktifkan</button>` : ""}<button type="button" class="text-button" data-reset-device="${esc(p.userId)}">Reset perangkat</button></div>`).join("");
  } catch (error) { container.innerHTML = `<p class="dashboard-empty">${esc(error.message || "Permintaan tidak dapat dimuat.")}</p>`; }
}



function setAdminIntro(message) {
  let intro = $("#adminIntro");
  if (!intro) {
    intro = document.createElement("p");
    intro.id = "adminIntro";
    $("#dialogTitle").insertAdjacentElement("afterend", intro);
  }
  intro.textContent = message;
}

function ensureCatalogStats() {
  if ($("#catalogStats")) return;
  $("#apps").insertAdjacentHTML("beforebegin", '<div id="catalogStats" class="catalog-stats" aria-live="polite"></div>');
}

function renderApps() {
  const query = ($("#search")?.value || "").trim().toLocaleLowerCase("id");
  const filtered = catalogItems.filter((item) =>
    `${item.name || ""} ${item.description || ""} ${item.version || ""}`.toLocaleLowerCase("id").includes(query)
  );
  const sortMode = $("#sortApps")?.value || "newest";
  const sorted = filtered.slice().sort((a, b) => {
    if (sortMode === "popular") return (Number(b.downloads) || 0) - (Number(a.downloads) || 0);
    if (sortMode === "az") return String(a.name || "").localeCompare(String(b.name || ""), "id", { sensitivity: "base", numeric: true });
    const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0;
    const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;
    return dateB - dateA;
  });

  ensureCatalogStats();
  const recentlyUpdated = catalogItems.filter(item => item.isUpdate);
  let updateNotice = document.querySelector("#catalogUpdateNotice");
  if (!updateNotice) {
    updateNotice = document.createElement("aside");
    updateNotice.id = "catalogUpdateNotice";
    updateNotice.className = "catalog-update-notice";
    updateNotice.setAttribute("aria-live", "polite");
    const statsNode = document.querySelector("#catalogStats");
    if (statsNode) statsNode.insertAdjacentElement("afterend", updateNotice);
  }
  if (updateNotice) {
    updateNotice.hidden = recentlyUpdated.length === 0;
    updateNotice.innerHTML = recentlyUpdated.length
      ? `<strong>🔔 Ada ${recentlyUpdated.length} aplikasi diperbarui</strong><span>${recentlyUpdated.slice(0, 3).map(item => `${esc(item.name)} · v${esc(item.version)}`).join("  •  ")}${recentlyUpdated.length > 3 ? `  •  +${recentlyUpdated.length - 3} lainnya` : ""}</span>`
      : "";
  }
  const totalDownloads = catalogItems.reduce((total, item) => total + (Number(item.downloads) || 0), 0);
  const downloadSummary = loggedIn
    ? ` • ${totalDownloads.toLocaleString("id-ID")} total unduhan`
    : "";
  $("#catalogStats").textContent = query
    ? `Menampilkan ${filtered.length} dari ${catalogItems.length} aplikasi${downloadSummary}`
    : `${catalogItems.length} aplikasi tersedia${downloadSummary}`;

  if (!filtered.length) {
    $("#apps").innerHTML = `<div class="catalog-empty">
      <span class="empty-mark">⌕</span>
      <strong>${query ? "Aplikasi tidak ditemukan" : "Belum ada aplikasi"}</strong>
      <p>${query ? "Coba kata kunci pencarian yang lain." : "Aplikasi yang diunggah akan muncul di sini."}</p>
    </div>`;
    return;
  }

  $("#apps").innerHTML = sorted.map((item) => {
    const icon = appIcon(item.name);
    const description = item.description || "Aplikasi Android untuk perangkat Anda.";
    return `<article class="app">
      <div class="app-topline">
        <div class="app-icon" style="--icon-bg:${icon.background};--icon-accent:${icon.accent}" aria-label="${esc(item.name || "Ikon aplikasi")}">
          ${item.iconUrl
            ? `<img class="app-icon-image" src="${esc(item.iconUrl)}" alt="" loading="lazy"><span class="app-icon-fallback" hidden>${esc(icon.symbol)}</span>`
            : `<span class="app-icon-fallback">${esc(icon.symbol)}</span>`}
          <small>APK</small>
        </div>
        <div class="app-title">
          <div class="app-name-line">
            <h3>${esc(item.name || "Aplikasi")}</h3>
            ${item.isUpdate ? '<span class="update-badge">UPDATE</span>' : ""}
          </div>
          <p>${esc(description)}</p>
          ${item.isUpdate && item.updatedAt ? `<small class="update-date">Versi baru · ${esc(new Date(item.updatedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }))}</small>` : ""}
        </div>
      </div>
      <div class="app-meta">
        <span class="meta-pill"><small>VERSI</small><strong>${esc(item.version || "—")}</strong></span>
        <span class="meta-pill"><small>UKURAN</small><strong>${esc(formatSize(item.size))}</strong></span>
        ${loggedIn ? `<span class="meta-pill"><small>UNDUHAN</small><strong>${(Number(item.downloads) || 0).toLocaleString("id-ID")}x</strong></span>` : ""}
      </div>
      <div class="app-actions">
        <a class="download" href="/download/${encodeURIComponent(item.id)}">↓ <span>Unduh APK</span></a>
        ${loggedIn ? `<button class="delete-button" type="button" data-delete="${esc(item.id)}">Hapus</button>` : ""}
      </div>
    </article>`;
  }).join("");

  $("#apps").querySelectorAll(".app-icon-image").forEach((image) => {
    image.addEventListener("error", () => {
      image.hidden = true;
      const fallback = image.nextElementSibling;
      if (fallback) fallback.hidden = false;
    }, { once: true });
  });
}

function ensurePremiumDialog() {
  if (document.querySelector("#premiumDialog")) return;
  const dialog = document.createElement("dialog"); dialog.id = "premiumDialog";
  dialog.innerHTML = `<button class="close" id="closePremium">✕</button><h2>IFAL57_WRT Premium</h2><p class="section-sub"><strong>Rp25.000 · Premium 30 hari</strong></p><div style="text-align:center"><img src="/qris.png" alt="QRIS IFAL57 STORE" style="width:min(100%,300px);border-radius:12px;background:white"><p>Scan QRIS di atas untuk membayar Rp25.000.</p></div><p id="premiumStatus" class="message">Login untuk mengajukan aktivasi Premium.</p><button class="primary" id="requestPayment">Saya sudah membayar</button><p class="section-sub">Premium aktif selama 30 hari setelah admin memverifikasi pembayaran.</p>`;
  document.body.appendChild(dialog);
  dialog.querySelector("#closePremium").addEventListener("click", () => dialog.close());
  dialog.querySelector("#requestPayment").addEventListener("click", async () => {
    const button = dialog.querySelector("#requestPayment"); button.disabled = true; button.textContent = "Mengirim...";
    try { const result = await request("/api/customer/payment-request", { method: "POST" }); dialog.querySelector("#premiumStatus").textContent = result.payment ? `Permintaan pembayaran ${result.payment.status === "pending" ? "sudah dikirim dan menunggu verifikasi admin" : result.payment.status}.` : "Permintaan terkirim."; button.textContent = "Permintaan terkirim"; }
    catch (error) { dialog.querySelector("#premiumStatus").textContent = error.message; button.disabled = false; button.textContent = "Saya sudah membayar"; }
  });
}
function openPremiumDialog() { ensurePremiumDialog(); const dialog = $("#premiumDialog"); dialog.showModal(); }

function setCustomerMessage(message, type = "info") {
  const node = $("#customerMessage");
  node.textContent = message; node.className = `message ${type}`;
}

function renderCustomerAccount() {
  const bar = $("#accountBar");
  if (!customerAccount) {
    bar.hidden = true;
    $("#userBtn").textContent = "Login / Daftar";
    return;
  }
  bar.hidden = false;
  const expiry = customerAccount.trialEndsAt ? new Date(customerAccount.trialEndsAt) : null;
  const premiumExpiry = customerAccount.premiumExpiresAt ? new Date(customerAccount.premiumExpiresAt) : null;
  const remainingDays = customerAccount.plan === "trial" && expiry
    ? Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / 86400000)) : 0;
  const isPremium = customerAccount.plan === "lifetime" || customerAccount.plan === "premium";
  const isTrial = customerAccount.plan === "trial";
  const status = isPremium ? (customerAccount.plan === "lifetime" ? "Premium Lifetime" : "Premium Aktif") : isTrial ? "Trial Aktif" : "Trial Berakhir";
  const dateLabel = expiry && !Number.isNaN(expiry.getTime())
    ? expiry.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "—";
  const daysLabel = remainingDays > 1 ? `${remainingDays} hari tersisa`
    : remainingDays === 1 ? "1 hari tersisa" : "Berakhir hari ini";
  document.body.classList.toggle("customer-logged-in", true);
  bar.innerHTML = `
    <div class="customer-dashboard customer-dashboard-compact">
      <div class="customer-compact-head">
        <div>
          <span class="customer-kicker">AKUN PELANGGAN</span>
          <h2>Halo, ${esc((customerAccount.email || "Pelanggan").split("@")[0])}</h2>
          <p>${esc(customerAccount.email || "")}</p>
        </div>
        <span class="customer-avatar">${esc((customerAccount.email || "U").slice(0,1).toUpperCase())}</span>
      </div>
      <section class="customer-plan-card ${isPremium ? "is-premium" : isTrial ? "is-trial" : "is-expired"}">
        <div class="customer-card-top">
          <span>STATUS LANGGANAN</span>
          <span class="status-pill">${status}</span>
        </div>
        <strong class="customer-plan-title">${isPremium ? (customerAccount.plan === "lifetime" ? "Premium Lifetime" : "Premium 30 hari") : isTrial ? `${remainingDays} hari tersisa` : "Trial telah berakhir"}</strong>
        <p>${isPremium ? (customerAccount.plan === "lifetime" ? "Akun Anda memiliki akses Premium tanpa batas waktu." : `Premium berakhir pada ${premiumExpiry ? premiumExpiry.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "30 hari setelah aktivasi"}.`) : isTrial ? `Trial gratis berakhir pada ${dateLabel}.` : "Aktifkan Premium untuk melanjutkan akses unduhan."}</p>
        ${isTrial ? `<div class="trial-progress"><span style="width:${Math.max(0,Math.min(100,remainingDays/7*100))}%"></span></div>` : ""}
        ${!isPremium ? `<button type="button" id="openPremium" class="primary customer-upgrade">${isTrial ? "Lihat Premium · Rp25.000" : "Aktifkan Premium · Rp25.000"}</button>` : ""}
      </section>
      <div class="customer-quick-info">
        <span>● Perangkat ${customerAccount.deviceBound ? "terhubung" : "belum terhubung"}</span>
        <span>● Katalog ${customerAccount.canDownload ? "tersedia" : "dibatasi"}</span>
      </div>
      <div class="customer-compact-actions">
        <button type="button" id="browseCatalog" class="catalog-cta"><strong>Buka katalog aplikasi</strong><span>→</span></button>
        <button type="button" id="customerLogout" class="customer-logout">Keluar</button>
      </div>
    </div>`;
  $("#userBtn").textContent = isPremium ? "Premium aktif" : "Akun saya";
}
async function refreshCustomer() {
  try { const data = await request("/api/customer/me", { cache: "no-store" }); customerAccount = data.account || null; }
  catch (_) { customerAccount = null; }
  renderCustomerAccount();
}

function showCustomerForm(view = "login") {
  $("#customerForm").hidden = view !== "login" && view !== "register";
  $("#forgotPasswordForm").hidden = view !== "forgot";
  $("#resetPasswordForm").hidden = view !== "reset";
  $("#forgotPasswordBtn").hidden = view !== "login";
  $("#toggleCustomerMode").hidden = view === "forgot" || view === "reset";
}

function openCustomerDialog(mode = "login") {
  customerMode = mode;
  showCustomerForm(mode);
  $("#userDialogTitle").textContent = mode === "register" ? "Daftar IFAL57_WRT" : "Login IFAL57_WRT";
  $("#customerSubmit").textContent = mode === "register" ? "Daftar & mulai trial" : "Login";
  $("#toggleCustomerMode").textContent = mode === "register" ? "Sudah punya akun? Login" : "Belum punya akun? Daftar";
  $("#customerForm").elements.password.autocomplete = mode === "register" ? "new-password" : "current-password";
  $("#userDialogNote").textContent = "Masuk atau daftar untuk menikmati trial gratis 7 hari.";
  setCustomerMessage(mode === "register" ? "Trial gratis 7 hari dimulai setelah pendaftaran berhasil." : "Masuk untuk mengakses unduhan sesuai status akun.");
  userDialog.showModal();
}

$("#userBtn").addEventListener("click", () => openCustomerDialog("login"));
document.addEventListener("click", async (event) => {
  if (event.target.closest("#openPremium")) openPremiumDialog();
  if (event.target.closest("#refreshPayments")) loadPaymentRequests();
  const approve = event.target.closest("[data-approve-payment]");
  if (approve) { approve.disabled = true; try { await request(`/api/admin/payments/${encodeURIComponent(approve.dataset.approvePayment)}/approve`, { method: "POST" }); await loadPaymentRequests(); await loadApps(); setMessage("Pembayaran disetujui. Premium aktif selama 30 hari.", "success"); } catch (error) { approve.disabled = false; setMessage(error.message, "error"); } }
  const approveApp = event.target.closest("[data-approve-app-access]");
  if (approveApp) {
    if (!confirm("Setujui akun ini agar bisa login melalui aplikasi Android pada Device ID yang diminta?")) return;
    approveApp.disabled = true;
    approveApp.textContent = "Menyetujui...";
    try {
      await request(`/api/admin/users/${encodeURIComponent(approveApp.dataset.approveAppAccess)}/approve-app-access`, { method: "POST" });
      await loadRegisteredUsers();
      setMessage("Akses login aplikasi disetujui. Pengguna sekarang bisa login di Android.", "success");
    } catch (error) {
      approveApp.disabled = false;
      approveApp.textContent = "Setujui login aplikasi";
      setMessage(error.message || "Gagal menyetujui akses aplikasi.", "error");
    }
    return;
  }
  const deleteUser = event.target.closest("[data-delete-user]");
  if (deleteUser) {
    if (!confirm("Sembunyikan akun ini dari daftar admin? Akun dan password tetap tersimpan. Pengguna bisa login kembali dengan email dan password yang sama.")) return;
    deleteUser.disabled = true;
    deleteUser.textContent = "Menghapus...";
    try {
      await request(`/api/admin/users/${encodeURIComponent(deleteUser.dataset.deleteUser)}`, { method: "DELETE" });
      await loadRegisteredUsers();
      await loadPaymentRequests();
      await loadAdminStats();
      setMessage("Akun disembunyikan dari daftar admin. Pengguna tetap bisa login lagi dengan email dan password lama.", "success");
    } catch (error) {
      deleteUser.disabled = false;
      deleteUser.textContent = "Hapus akun";
      setMessage(error.message || "Gagal menghapus akun.", "error");
    }
    return;
  }
  const reset = event.target.closest("[data-reset-device]");
  if (reset) {
    if (!confirm("Reset ikatan perangkat akun ini? Akun akan terikat ke perangkat berikutnya saat login.")) return;
    reset.disabled = true;
    try { await request(`/api/admin/users/${encodeURIComponent(reset.dataset.resetDevice)}/reset-device`, { method: "POST" }); await loadPaymentRequests(); await loadRegisteredUsers(); setMessage("Ikatan perangkat direset. Login berikutnya akan mengikat perangkat baru.", "success"); }
    catch (error) { reset.disabled = false; setMessage(error.message, "error"); }
  }
});
$("#closeUserDialog").addEventListener("click", () => userDialog.close());
$("#toggleCustomerMode").addEventListener("click", () => openCustomerDialog(customerMode === "login" ? "register" : "login"));
$("#forgotPasswordBtn").addEventListener("click", () => {
  showCustomerForm("forgot");
  $("#userDialogTitle").textContent = "Lupa password";
  $("#forgotPasswordForm").elements.email.value = $("#customerForm").elements.email.value;
  setCustomerMessage("Masukkan email yang kamu gunakan saat mendaftar.");
});
$("#backToLogin").addEventListener("click", () => openCustomerDialog("login"));
$("#forgotPasswordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Mengirim...";
  try {
    const result = await request("/api/customer/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.elements.email.value })
    });
    setCustomerMessage(result.message || "Jika email terdaftar, link reset akan dikirim.", "success");
  } catch (error) {
    setCustomerMessage(error.message || "Tidak bisa mengirim link reset.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Kirim link reset";
  }
});
$("#resetPasswordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const token = new URLSearchParams(location.search).get("reset");
  button.disabled = true;
  button.textContent = "Menyimpan...";
  try {
    const result = await request("/api/customer/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: form.elements.password.value })
    });
    history.replaceState({}, "", location.pathname);
    form.reset();
    openCustomerDialog("login");
    setCustomerMessage(result.message || "Password berhasil diganti. Silakan login.", "success");
  } catch (error) {
    setCustomerMessage(error.message || "Password belum bisa diganti.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Simpan password baru";
  }
});
$("#customerForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget; const button = $("#customerSubmit");
  const data = Object.fromEntries(new FormData(form)); button.disabled = true; button.textContent = "Memproses...";
  try {
    const result = await request(customerMode === "register" ? "/api/customer/register" : "/api/customer/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    customerAccount = result.account; renderCustomerAccount(); userDialog.close(); form.reset();
    const params = new URLSearchParams(location.search);
    if (params.has("login") || params.has("trial")) history.replaceState({}, "", location.pathname);
    await loadApps();
  } catch (error) { setCustomerMessage(error.message || "Tidak bisa memproses akun.", "error"); }
  finally { button.disabled = false; button.textContent = customerMode === "register" ? "Daftar & mulai trial" : "Login"; }
});

$("#accountBar").addEventListener("click", async (event) => {
  if (event.target.closest("#browseCatalog")) {
    $("#catalog").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (!event.target.closest("#customerLogout")) return;
  try { await request("/api/customer/logout", { method: "POST" }); customerAccount = null; renderCustomerAccount(); await loadApps(); }
  catch (error) { alert(error.message); }
});

async function loadCustomerHistory() {
  const list = $("#customerHistoryList");
  if (!list || !customerAccount) return;
  try {
    const data = await request("/api/customer/history", { cache: "no-store" });
    const items = Array.isArray(data.history) ? data.history : [];
    const count = $("#customerHistoryCount");
    if (count) count.textContent = String(items.length);
    list.innerHTML = items.length ? items.slice(0, 5).map(item => {
      const date = item.date ? new Date(item.date).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "Tanggal tidak tersedia";
      return `<div class="history-row"><span class="history-app-icon">APK</span><span class="history-app-copy"><strong>${esc(item.appName)}</strong><small>${esc(date)}</small></span><span class="history-done">Selesai</span></div>`;
    }).join("") : '<p class="history-empty">Belum ada download dari akun ini. Aplikasi yang Anda unduh setelah pembaruan akan tampil di sini.</p>';
  } catch (_) {
    list.innerHTML = '<p class="history-empty">Riwayat download belum dapat dimuat.</p>';
  }
}

async function loadApps() {
  $("#apps").innerHTML = '<div class="catalog-loading">Memuat katalog aplikasi...</div>';
  try {
    const items = await request("/api/apps", { cache: "no-store" });
    catalogItems = Array.isArray(items) ? items : [];
    renderApps();
  } catch (error) {
    $("#apps").innerHTML = `<div class="catalog-empty">
      <strong>Katalog belum bisa dimuat</strong>
      <p>${esc(error.message || "Periksa koneksi lalu coba lagi.")}</p>
      <button class="retry-button" type="button" id="retryApps">Coba lagi</button>
    </div>`;
    $("#catalogStats")?.remove();
    $("#retryApps")?.addEventListener("click", loadApps);
  }
}

async function openAdmin() {
  setMessage("", "info");
  try {
    const [status, me] = await Promise.all([
      request("/api/status"),
      request("/api/me")
    ]);
    setupRequired = !!status.setupRequired;
    loggedIn = !!me.admin;

    $("#authForm").hidden = loggedIn;
    $("#uploadForm").hidden = !loggedIn;
    $("#logout").hidden = !loggedIn;
    $("#dialogTitle").textContent = loggedIn
      ? "Kelola aplikasi"
      : setupRequired ? "Buat admin pertama" : "Login admin";

    $("#authSubmit").textContent = setupRequired ? "Buat akun admin" : "Masuk";
    setAdminIntro(loggedIn
      ? "Unggah APK baru ke katalog IFAL57_WRT. File APK maksimal 300 MB."
      : setupRequired
        ? "Buat akun admin untuk mengelola katalog. Password minimal 10 karakter."
        : "Masuk untuk mengunggah atau menghapus aplikasi dari katalog.");
    dialog.showModal();
    if (loggedIn) {
      await loadApps();
      await loadAdminStats();
    } else {
      $("#adminDashboard")?.setAttribute("hidden", "");
      renderApps();
    }
  } catch (error) {
    dialog.showModal();
    $("#dialogTitle").textContent = "Panel Admin";
    setAdminIntro("Panel admin belum dapat dihubungkan ke server.");
    setMessage(error.message || "Periksa koneksi internet.", "error");
  }
}

$("#adminBtn").addEventListener("click", openAdmin);
document.addEventListener("click", (event) => {
  const adminAction = event.target.closest("[data-admin-action]");
  if (adminAction?.dataset.adminAction === "upload") {
    const area = $("#adminUploadArea");
    if (area) { area.hidden = !area.hidden; if (!area.hidden) area.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  }
  if (adminAction?.dataset.adminAction === "premium") {
    const panel = $("#adminPaymentsPanel");
    if (panel) { panel.open = true; panel.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  }
  if (event.target.closest("#refreshAdminStats")) loadAdminStats();
  if (event.target.closest("#refreshUsers")) loadRegisteredUsers();
  if (event.target.closest("#refreshPayments")) loadPaymentRequests();
});
$("#closeDialog").addEventListener("click", () => dialog.close());
$("#search").addEventListener("input", renderApps);
$("#sortApps")?.addEventListener("change", renderApps);

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#authSubmit");
  const data = Object.fromEntries(new FormData(form));

  if (setupRequired && String(data.password || "").length < 10) {
    setMessage("Password admin minimal 10 karakter.", "error");
    return;
  }

  button.disabled = true;
  button.textContent = "Memproses...";
  setMessage(setupRequired ? "Sedang membuat akun admin..." : "Sedang memeriksa akun...", "info");
  try {
    await request(setupRequired ? "/api/setup" : "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    loggedIn = true;
    $("#authForm").hidden = true;
    $("#uploadForm").hidden = false;
    $("#logout").hidden = false;
    $("#dialogTitle").textContent = "Kelola aplikasi";
    setAdminIntro("Unggah APK baru ke katalog IFAL57_WRT. File APK maksimal 300 MB.");
    setMessage("Login berhasil. Anda sekarang bisa mengelola aplikasi.", "success");
    form.reset();
    await loadApps();
    await loadAdminStats();
  } catch (error) {
    setMessage(error.message || "Login gagal. Coba lagi.", "error");
  } finally {
    button.disabled = false;
    button.textContent = setupRequired ? "Buat akun admin" : "Masuk";
  }
});

const apkInput = $("#uploadForm").elements.apk;
apkInput.accept = ".apk,application/vnd.android.package-archive";
const fileHint = document.createElement("small");
fileHint.className = "file-note";
fileHint.textContent = "Format APK • Maksimal 300 MB";
apkInput.closest("label").appendChild(fileHint);
apkInput.addEventListener("change", () => {
  const file = apkInput.files[0];
  fileHint.textContent = file ? `${file.name} · ${formatSize(file.size)}` : "Format APK • Maksimal 300 MB";
});

$("#uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.apk.files[0];
  const button = form.querySelector('button[type="submit"], button:not([type])');

  if (!file) return setMessage("Pilih file APK terlebih dahulu.", "error");
  if (!file.name.toLowerCase().endsWith(".apk")) return setMessage("File harus berformat .apk.", "error");
  if (file.size > 300 * 1024 * 1024) return setMessage("Ukuran file melebihi batas 300 MB.", "error");

  button.disabled = true;
  button.textContent = "Mengunggah...";
  setMessage("File sedang dikirim ke server. Jangan tutup halaman sampai selesai.", "info");
  try {
    const uploadResult = await request("/api/upload", { method: "POST", body: new FormData(form) });
    form.reset();
    fileHint.textContent = "Format APK • Maksimal 300 MB";
    setMessage(uploadResult.updated
      ? (uploadResult.versionChanged
        ? "Versi aplikasi berhasil diperbarui. Label UPDATE tampil di katalog."
        : "File aplikasi berhasil diganti. Nomor versi tidak berubah.")
      : "APK berhasil diunggah dan sudah masuk ke katalog.", "success");
    await loadApps();
    await loadAdminStats();
  } catch (error) {
    setMessage(error.message || "Upload gagal. Periksa koneksi lalu coba lagi.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Upload APK";
  }
});

$("#apps").addEventListener("click", (event) => {
  const link = event.target.closest("a.download");
  if (!link) return;

  // Satu ID unik untuk satu klik; browser retry akan memakai URL/ID yang sama.
  const url = new URL(link.href, window.location.href);
  if (!url.searchParams.has("downloadId")) {
    const id = (window.crypto && typeof window.crypto.randomUUID === "function")
      ? window.crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    url.searchParams.set("downloadId", id);
    link.href = url.pathname + url.search;
  }
});

$("#apps").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button || button.disabled) return;
  if (!confirm("Yakin ingin menghapus aplikasi ini dari katalog?")) return;

  button.disabled = true;
  button.textContent = "Menghapus...";
  try {
    await request(`/api/apps/${encodeURIComponent(button.dataset.delete)}`, { method: "DELETE" });
    setMessage("Aplikasi berhasil dihapus.", "success");
    await loadApps();
    await loadAdminStats();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Hapus";
    setMessage(error.message || "Gagal menghapus aplikasi.", "error");
  }
});

$("#logout").addEventListener("click", async () => {
  try {
    await request("/api/logout", { method: "POST" });
    loggedIn = false;
    $("#authForm").hidden = false;
    $("#uploadForm").hidden = true;
    $("#logout").hidden = true;
    dialog.close();
    await loadApps();
  } catch (error) {
    setMessage(error.message || "Gagal keluar dari akun admin.", "error");
  }
});



// About & customer support dialog
(() => {
  const aboutDialog = $("#aboutDialog");
  const openButton = $("#aboutBtn");
  if (!aboutDialog || !openButton) return;
  const closeAbout = () => aboutDialog.close();
  openButton.addEventListener("click", () => {
    const ua = navigator.userAgent || "";
    let device = "Perangkat tidak terdeteksi";
    const android = ua.match(/Android\s([0-9.]+)/i);
    const model = ua.match(/;\s*([^;)]+)\s*Build\//i);
    if (android) device = `${model ? model[1].trim() + " · " : ""}Android ${android[1]}`;
    else if (/Android/i.test(ua)) device = "Perangkat Android";
    else if (/iPhone|iPad/i.test(ua)) device = "Perangkat iOS";
    else if (/Windows/i.test(ua)) device = "Windows";
    else if (/Macintosh/i.test(ua)) device = "macOS";
    $("#aboutDeviceInfo").textContent = device;
    aboutDialog.showModal();
  });
  $("#closeAboutDialog").addEventListener("click", closeAbout);
  $("#aboutDone").addEventListener("click", closeAbout);
  aboutDialog.addEventListener("click", (event) => {
    if (event.target === aboutDialog) closeAbout();
  });
})();

refreshCustomer().then(() => {
  loadApps();
  const params = new URLSearchParams(location.search);
  if (params.has("reset")) {
    userDialog.showModal();
    showCustomerForm("reset");
    $("#userDialogTitle").textContent = "Buat password baru";
    setCustomerMessage("Masukkan password baru minimal 10 karakter.");
  } else if (params.has("login")) openCustomerDialog("login");
  if (params.has("trial")) { openCustomerDialog("login"); setCustomerMessage("Masa trial sudah berakhir. Login untuk melihat status akun dan informasi Premium.", "error"); }
});


/* Remote-control directional navigation. Activated only in TV/STB mode. */
(() => {
  const ua = navigator.userAgent || "";
  const coarseLargeScreen = window.matchMedia("(min-width: 900px) and (hover: none)").matches;
  const tvUA = /Android TV|GoogleTV|AFT[A-Z0-9]*|BRAVIA|SHIELD Android TV|MiTV/i.test(ua);
  if (!tvUA && !coarseLargeScreen) return;

  document.documentElement.classList.add("tv-mode");

  const selector = [
    "a[href]", "button:not([disabled])", "input:not([disabled]):not([type=hidden])",
    "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  function visible(el) {
    if (!el || !el.isConnected || el.closest("[hidden], [inert]")) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" &&
      el.getClientRects().length > 0;
  }

  document.addEventListener("keydown", (event) => {
    const directions = {
      ArrowUp: [0, -1], ArrowDown: [0, 1],
      ArrowLeft: [-1, 0], ArrowRight: [1, 0]
    };
    const direction = directions[event.key];
    if (!direction || event.altKey || event.ctrlKey || event.metaKey) return;

    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;

    const items = [...document.querySelectorAll(selector)].filter(visible);
    if (!items.length) return;

    if (!items.includes(active)) {
      event.preventDefault();
      items[0].focus();
      return;
    }

    const [dx, dy] = direction;
    const current = active.getBoundingClientRect();
    const cx = current.left + current.width / 2;
    const cy = current.top + current.height / 2;
    let best = null;
    let bestScore = Infinity;

    for (const item of items) {
      if (item === active) continue;
      const rect = item.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const primary = dx ? (x - cx) * dx : (y - cy) * dy;
      if (primary <= 2) continue;
      const cross = dx ? Math.abs(y - cy) : Math.abs(x - cx);
      const score = primary + cross * 2.25;
      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    }

    if (best) {
      event.preventDefault();
      best.focus({ preventScroll: true });
      best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  });
})();


// Pengaturan tema 57 Store: tersimpan lokal dan tidak mengubah data akun/katalog.
(() => {
  const button = document.getElementById('themeToggle');
  if (!button) return;
  const root = document.documentElement;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  const storageKey = 'ifal57_theme_v1';
  let saved = 'light';
  try { saved = localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light'; } catch (_) {}
  const applyTheme = (theme) => {
    const dark = theme === 'dark';
    root.dataset.theme = dark ? 'dark' : 'light';
    button.textContent = dark ? '☀️' : '🌙';
    button.setAttribute('aria-pressed', dark ? 'true' : 'false');
    button.setAttribute('aria-label', dark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
    button.title = dark ? 'Mode terang' : 'Mode gelap';
    if (metaTheme) metaTheme.setAttribute('content', dark ? '#0b1214' : '#031b1a');
  };
  applyTheme(saved);
  button.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(storageKey, next); } catch (_) {}
  });
})();
