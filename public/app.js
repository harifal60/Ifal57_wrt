const $ = s => document.querySelector(s);
const dialog = $("#adminDialog");
let setup = false, logged = false;
async function loadApps(){
  const items = await fetch("/api/apps").then(r=>r.json());
  const q = $("#search").value.toLowerCase();
  const shown = items.filter(x=>(x.name+" "+x.description).toLowerCase().includes(q));
  $("#apps").innerHTML = shown.length ? shown.map(x=>`<article class="app"><h3>${esc(x.name)}</h3><div class="muted">Versi ${esc(x.version)} · ${(x.size/1048576).toFixed(1)} MB</div><p class="muted">${esc(x.description||"")}</p><a class="download" href="/download/${encodeURIComponent(x.id)}">Unduh APK</a>${logged?` <button data-delete="${esc(x.id)}">Hapus</button>`:""}</article>`).join("") : '<p class="muted">Belum ada aplikasi yang diunggah.</p>';
  document.querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{if(confirm("Hapus aplikasi ini?")){await fetch("/api/apps/"+b.dataset.delete,{method:"DELETE"});loadApps();}});
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function openAdmin(){
  const st=await fetch("/api/status").then(r=>r.json()); setup=st.setupRequired;
  const me=await fetch("/api/me").then(r=>r.json()); logged=!!me.admin;
  $("#authForm").hidden=logged;$("#uploadForm").hidden=!logged;$("#logout").hidden=!logged;
  $("#dialogTitle").textContent=logged?"Upload APK":setup?"Buat Admin Pertama":"Login Admin";
  $("#authSubmit").textContent=setup?"Buat Admin":"Masuk";$("#message").textContent="";
  dialog.showModal();
}
$("#adminBtn").onclick=openAdmin;$("#closeDialog").onclick=()=>dialog.close();$("#search").oninput=loadApps;
$("#authForm").onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));const r=await fetch(setup?"/api/setup":"/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const d=await r.json();if(!r.ok){$("#message").textContent=d.error;return;}logged=true;$("#authForm").hidden=true;$("#uploadForm").hidden=false;$("#logout").hidden=false;$("#dialogTitle").textContent="Upload APK";loadApps();};
$("#uploadForm").onsubmit=async e=>{e.preventDefault();const r=await fetch("/api/upload",{method:"POST",body:new FormData(e.target)});const d=await r.json();$("#message").textContent=r.ok?"APK berhasil diunggah.":d.error;if(r.ok){e.target.reset();loadApps();}};
$("#logout").onclick=async()=>{await fetch("/api/logout",{method:"POST"});logged=false;dialog.close();loadApps();};
loadApps();
