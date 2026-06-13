// Daily refresh of REAL price histories into Supabase, so the whole app can run
// on real data without blowing the free data-feed limit.
//
// The free feed allows ~8 companies a minute, so each call fetches up to 8
// companies that are MISSING or stale (>20h old), then reports how many remain.
// The client calls this repeatedly (spaced ~1/min) until the cache is full;
// after that, calls find nothing stale and do nothing.
//
// GET /api/refresh-histories?symbols=AAPL,MSFT,...  ->  { refreshed, remaining }
const SUPABASE_URL = "https://eejamqewfosbwkkhezho.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlamFtcWV3Zm9zYndra2hlemhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExOTU4NzIsImV4cCI6MjA5Njc3MTg3Mn0.dIkB7ajf2Mnrufxb5uHzM1vOa9qBuZUzZ9OK8oAiw9E";
// Prefer the server-only service key (works even after we lock `histories`
// writes to read-only for the public). Falls back to anon until that key is set.
const WRITE_KEY = process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON;
const SUPA = { apikey: WRITE_KEY, Authorization: "Bearer " + WRITE_KEY, "Content-Type": "application/json" };
const CHUNK = 8;          // companies per call (free feed ~8 credits/min)
const STALE_HOURS = 20;

module.exports = async (req, res) => {
  const key = process.env.TWELVE_DATA_KEY;
  if (!key) { res.status(500).json({ error: "TWELVE_DATA_KEY not set" }); return; }

  let symbols = String((req.query && req.query.symbols) || "")
    .split(",").map(s => s.trim().toUpperCase()).filter(s => /^[A-Z.]{1,8}$/.test(s));
  symbols = Array.from(new Set(symbols));
  if (!symbols.length) { res.status(400).json({ error: "no symbols" }); return; }

  // Which ones are already fresh in the cache?
  const ageH = {};
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/histories?select=ticker,updated_at", { headers: SUPA });
    const rows = await r.json();
    if (Array.isArray(rows)) rows.forEach(row => { ageH[row.ticker] = (Date.now() - new Date(row.updated_at).getTime()) / 3.6e6; });
  } catch (e) { /* table missing -> everything is "stale" */ }

  const stale = symbols.filter(s => !(s in ageH) || ageH[s] > STALE_HOURS);
  if (!stale.length) { res.status(200).json({ refreshed: 0, remaining: 0, allFresh: true }); return; }
  const batch = stale.slice(0, CHUNK);

  try {
    const url = "https://api.twelvedata.com/time_series?symbol=" + encodeURIComponent(batch.join(",")) +
      "&interval=1day&outputsize=200&apikey=" + key;
    const data = await (await fetch(url)).json();
    const perSymbol = (data && data.values) ? { [batch[0]]: data } : (data || {});
    const upserts = [];
    for (const sym of batch) {
      const e = perSymbol[sym];
      if (e && e.status === "ok" && Array.isArray(e.values)) {
        const prices = e.values.map(v => parseFloat(v.close)).filter(n => Number.isFinite(n) && n > 0).reverse();
        if (prices.length >= 25) upserts.push({ ticker: sym, prices: prices, updated_at: new Date().toISOString() });
      }
    }
    if (upserts.length) {
      const w = await fetch(SUPABASE_URL + "/rest/v1/histories?on_conflict=ticker", {
        method: "POST",
        headers: Object.assign({ "Prefer": "resolution=merge-duplicates" }, SUPA),
        body: JSON.stringify(upserts)
      });
      if (!w.ok) { res.status(500).json({ error: "cache write failed", detail: (await w.text()).slice(0, 160) }); return; }
    }
    res.status(200).json({ refreshed: upserts.length, remaining: Math.max(0, stale.length - upserts.length) });
  } catch (e) {
    res.status(502).json({ error: "refresh failed", detail: String(e).slice(0, 120) });
  }
};
