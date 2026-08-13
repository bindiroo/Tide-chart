// ============================================================
// format.js — number / money / date helpers.
// ============================================================
export const fmtMoney = (n) =>
  "$" + Math.round(n || 0).toLocaleString("en-US");
export const fmtMoneyShort = (n) => {
  n = n || 0;
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return "$" + Math.round(n / 1e3) + "k";
  return "$" + Math.round(n);
};
export const fmtNum = (n) => Math.round(n || 0).toLocaleString("en-US");
export const fmtNumShort = (n) => {
  n = n || 0;
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return Math.round(n / 1e3) + "k";
  return String(Math.round(n));
};

// yyyymmdd int <-> Date / display
export const ymdToParts = (v) => ({ y: Math.floor(v / 10000), m: Math.floor(v / 100) % 100, d: v % 100 });
export const ymdToInput = (v) => {   // -> "YYYY-MM-DD" for <input type=date>
  if (!v) return "";
  const { y, m, d } = ymdToParts(v);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
export const inputToYmd = (s) => {   // "YYYY-MM-DD" -> yyyymmdd int (0 if empty)
  if (!s) return 0;
  const [y, m, d] = s.split("-").map(Number);
  return y * 10000 + m * 100 + d;
};
export const ymdToDisplay = (v) => {
  if (!v) return "—";
  const { y, m, d } = ymdToParts(v);
  return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
};
