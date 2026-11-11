const f = document.getElementById("f");
const err = document.getElementById("err");
const b = document.getElementById("b");
window.jarvisDesktop.settings().then((s) => {
  document.getElementById("v").textContent = `Version ${s.version} · Strg + Leertaste öffnet Jarvis von überall`;
});
f.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.textContent = "";
  b.disabled = true;
  b.textContent = "Prüfe …";
  const r = await window.jarvisDesktop.setServer(document.getElementById("url").value);
  if (r && r.error) {
    err.textContent = r.error;
    b.disabled = false;
    b.textContent = "Verbinden";
  }
});
