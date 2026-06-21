// Shared server-side logic for the cheat-proof paper-trading game.
//
// The SERVER is the referee: it owns every account's cash + holdings, and the
// only way a score changes is through a real buy/sell that the server validates
// against real prices. The browser can never just claim a number, and because
// all writes use the service-role key here (never shipped to the client), no
// one can touch anyone else's row. RLS denies the public anon key all access to
// `accounts`, so this file is the only door in.
const crypto = require("crypto");

const SUPABASE_URL = "https://eejamqewfosbwkkhezho.supabase.co";

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return null;
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

// A player's secret "pass" is random and lives only in their browser. We store
// only its SHA-256 hash, so even a database leak can't impersonate anyone.
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

// Login identity = a key derived from (lowercased username + PIN). Same name +
// PIN always maps to the same account, on any device — so accounts are
// recoverable, without storing the PIN itself (we store only this hash). A wrong
// PIN derives a different key, so it can't reach someone else's account.
function deriveKey(username, pin) {
  return crypto.createHash("sha256")
    .update(String(username || "").trim().toLowerCase() + "::" + String(pin || ""))
    .digest("hex");
}

// PIN must be 4-6 digits (kid-friendly, easy to remember, hard to guess by luck).
function cleanPin(pin) {
  const p = String(pin || "").trim();
  return /^[0-9]{4,6}$/.test(p) ? p : null;
}

// Is this username already registered (by anyone)? Returns the matching rows
// (token_hash only) so the caller can tell "your account" from "name taken".
async function findByUsername(H, username) {
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/accounts?username=ilike." + encodeURIComponent(String(username).trim()) + "&select=token_hash", { headers: H });
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (e) { return []; }
}

function currentMonth() {
  const d = new Date();
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

const STARTING_CASH = 1000;

// Server-side username check — mirrors the client, but this is the one that
// actually matters (the client check is just for friendly errors).
const BLOCK = ["fuck","shit","bitch","cunt","nigger","nigga","faggot","retard","rape","nazi","hitler","penis","vagina","cock","dick","pussy","whore","slut","sex","porn"];
function cleanUsername(raw) {
  const name = String(raw || "").trim();
  if (name.length < 3 || name.length > 16) return { ok: false, msg: "Use 3-16 characters." };
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) return { ok: false, msg: "Letters, numbers, spaces, - and _ only." };
  const flat = name.toLowerCase().replace(/[\s_-]/g, "");
  if (BLOCK.some(w => flat.includes(w))) return { ok: false, msg: "Please pick a friendlier name." };
  return { ok: true, name };
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return await new Promise(resolve => {
    let d = ""; req.on("data", c => d += c);
    req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch (e) { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

// Fetch one account row by its token hash (or null).
async function getAccount(H, tokenHash) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/accounts?token_hash=eq." + tokenHash + "&select=*", { headers: H });
  if (!r.ok) return null;
  const rows = await r.json();
  return (Array.isArray(rows) && rows[0]) || null;
}

// Last cached close for a set of tickers, from the public price cache. Used to
// value holdings without spending a live-quote API call per stock.
async function cachedPrices(H, tickers) {
  const out = {};
  const list = Array.from(new Set(tickers)).filter(Boolean);
  if (!list.length) return out;
  const inList = list.map(t => encodeURIComponent(t)).join(",");
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/histories?ticker=in.(" + inList + ")&select=ticker,prices", { headers: H });
    if (r.ok) {
      const rows = await r.json();
      (rows || []).forEach(row => {
        if (Array.isArray(row.prices) && row.prices.length) out[row.ticker] = Number(row.prices[row.prices.length - 1]);
      });
    }
  } catch (e) { /* fall back to avg cost below */ }
  return out;
}

// One live quote (the traded ticker). Falls back to null on any failure.
async function liveQuote(symbol) {
  const key = process.env.FINNHUB_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://finnhub.io/api/v1/quote?symbol=" + encodeURIComponent(symbol) + "&token=" + key);
    if (!r.ok) return null;
    const d = await r.json();
    const p = d && Number(d.c);
    return (Number.isFinite(p) && p > 0) ? p : null;
  } catch (e) { return null; }
}

// Total portfolio value = cash + Σ shares × best-known price. Prefers a fresh
// override (the just-traded ticker), then the cached close, then average cost
// (so a held stock is never valued at 0 just because the cache missed it).
function computeValue(acct, prices, override) {
  let v = Number(acct.cash) || 0;
  const h = acct.holdings || {};
  for (const t in h) {
    const pos = h[t];
    if (!pos || !(pos.shares > 0)) continue;
    let px = (override && override.ticker === t) ? override.price : prices[t];
    if (!(px > 0)) px = pos.totalCost / pos.shares;   // avg-cost fallback
    if (px > 0) v += pos.shares * px;
  }
  return Math.round(v * 100) / 100;
}

// If the stored month is stale, start a fresh season: $1,000, no holdings.
function applyMonthlyReset(acct) {
  const m = currentMonth();
  if (acct.month !== m) {
    acct.month = m;
    acct.cash = STARTING_CASH;
    acct.holdings = {};
    acct.value = STARTING_CASH;
    return true;
  }
  return false;
}

async function patchAccount(H, id, fields) {
  fields.updated_at = new Date().toISOString();
  return fetch(SUPABASE_URL + "/rest/v1/accounts?id=eq." + id, {
    method: "PATCH", headers: Object.assign({ Prefer: "return=representation" }, H), body: JSON.stringify(fields)
  });
}

// What we hand back to the browser — never the token hash or internal ids.
function publicState(acct) {
  return { username: acct.username, cash: Number(acct.cash), holdings: acct.holdings || {}, value: Number(acct.value), month: acct.month };
}

module.exports = {
  SUPABASE_URL, STARTING_CASH, serviceHeaders, hashToken, deriveKey, cleanPin,
  findByUsername, currentMonth,
  cleanUsername, readBody, getAccount, cachedPrices, liveQuote, computeValue,
  applyMonthlyReset, patchAccount, publicState
};
