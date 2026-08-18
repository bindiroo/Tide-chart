// ============================================================
// gate.js — light branded password wall. Client-side only: a deterrent that
// keeps casual/uninvited eyes out, not hard security. The password is stored as
// a SHA-256 hash (not plaintext) and checked in the browser.
// ============================================================
const HASH = "e591eb27e3f9c5041466df89f5479875024715cb60a222cc4006b78bff005549";
const KEY = "tide_gate_ok_v1";

const gate = document.getElementById("gate");
const pass = document.getElementById("gatePass");
const err = document.getElementById("gateErr");

function unlock() {
  gate.style.display = "none";
  document.body.style.overflow = "";
}

if (localStorage.getItem(KEY) === HASH) {
  unlock();
} else {
  document.body.style.overflow = "hidden";   // block scrolling behind the wall
  if (pass) pass.focus();
}

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

document.getElementById("gateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  err.textContent = "";
  let h;
  try { h = await sha256(pass.value); }
  catch (_) { err.textContent = "This browser can't verify the password."; return; }
  if (h === HASH) {
    try { localStorage.setItem(KEY, HASH); } catch (_) {}
    unlock();
  } else {
    err.textContent = "Incorrect password. Try again.";
    pass.value = "";
    pass.focus();
  }
});
