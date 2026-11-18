/* IFAL57_WRT Premium 2.0 — catalog and admin interactions */
const $ = (selector) => document.querySelector(selector);
const dialog = $("#adminDialog");

let setupRequired = false;
let loggedIn = false;
let catalogItems = [];

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

async function request(url, options = {}) {
  const response = await fetch(url, options);
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
    <div class="dashboard-heading">
      <div>
        <span class="dashboard-kicker">OVERVIEW</span>
        <h3>Statistik Katalog</h3>
      </div>
      <button type="button" class="dashboard-refresh" id="refreshAdminStats">↻ Refresh</button>
    </div>
    <div class="dashboard-cards" id="dashboardCards"></div>
    <div class="dashboard-panel">
      <div class="dashboard-panel-title"><strong>Unduhan 7 hari terakhir</strong><span>Harian</span></div>
      <div class="dashboard-chart" id="dashboardChart"></div>
    </div>
    <div class="dashboard-panel">
      <div class="dashboard-panel-title"><strong>Aplikasi terpopuler</strong><span>Top 5</span></div>
      <div class="dashboard-ranking" id="dashboardRanking"></div>
    </div>`;
  const intro = $("#adminIntro");
  const uploadForm = $("#uploadForm");
  if (intro && uploadForm) uploadForm.parentNode.insertBefore(dashboard, uploadForm);
  else if (uploadForm) uploadForm.insertAdjacentElement("beforebegin", dashboard);
}

function renderAdminStats(stats) {
  const cards = $("#dashboardCards");
  const chart = $("#dashboardChart");
  const ranking = $("#dashboardRanking");
  if (!cards || !chart || !ranking) return;

  cards.innerHTML = `
    <div class="dashboard-stat"><span>Total aplikasi</span><strong>${Number(stats.appCount || 0).toLocaleString("id-ID")}</strong></div>
    <div class="dashboard-stat"><span>Total unduhan</span><strong>${Number(stats.totalDownloads || 0).toLocaleString("id-ID")}</strong></div>
    <div class="dashboard-stat"><span>Unduhan tercatat</span><strong>${Number(stats.trackedDownloads || 0).toLocaleString("id-ID")}</strong></div>`;

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
  } catch (error) {
    if (chart) chart.innerHTML = `<p class="dashboard-empty">${esc(error.message || "Statistik belum bisa dimuat.")}</p>`;
  }
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

  ensureCatalogStats();
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

  $("#apps").innerHTML = filtered.map((item) => {
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
          <h3>${esc(item.name || "Aplikasi")}</h3>
          <p>${esc(description)}</p>
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
  if (event.target.closest("#refreshAdminStats")) loadAdminStats();
});
$("#closeDialog").addEventListener("click", () => dialog.close());
$("#search").addEventListener("input", renderApps);

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
    await request("/api/upload", { method: "POST", body: new FormData(form) });
    form.reset();
    fileHint.textContent = "Format APK • Maksimal 300 MB";
    setMessage("APK berhasil diunggah dan sudah masuk ke katalog.", "success");
    await loadApps();
    await loadAdminStats();
  } catch (error) {
    setMessage(error.message || "Upload gagal. Periksa koneksi lalu coba lagi.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Upload APK";
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

loadApps();
