// Daily refresh of REAL price histories into Supabase, so the whole app can run
// on real data without blowing the free data-feed limit. Self-guards: if the
// cache was refreshed in the last ~20h it does nothing, so it only hits Twelve
// Data ~once a day no matter how often it's called.
//
// Called as GET /api/refresh-histories?symbols=AAPL,MSFT,...  (the client sends
// its tracked US tickers). Writes rows { ticker, prices, updated_at } via upsert.
const SUPABASE_URL = "https://eejamqewfosbwkkhezho.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlamFtcWV3Zm9zYndra2hlemhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExOTU4NzIsImV4cCI6MjA5Njc3MTg3Mn0.dIkB7ajf2Mnrufxb5uHzM1vOa9qBuZUzZ9OK8oAiw9E";
const SUPA = { apikey: SUPABASE_ANON, Authorization: "Bearer " + SUPABASE_ANON, "Content-Type": "application/json" };

module.exports = async (req, res) => {
  const key = process.env.TWELVE_DATA_KEY;
  if (!key) { res.status(500).json({ error: "TWELVE_DATA_KEY not set" }); return; }

  // 1) Staleness guard — skip if refreshed in the last ~20h (protects the daily quota)
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/histories?select=updated_at&order=updated_at.desc&limit=1", { headers: SUPA });
    const rows = await r.json();
    if (Array.isArray(rows) && rows[0] && rows[0].updated_at) {
      const ageH = (Date.now() - new Date(rows[0].updated_at).getTime()) / 3.6e6;
      if (ageH < 20) { res.status(200).json({ skipped: true, ageHours: Math.round(ageH) }); return; }
    }
  } catch (e) { /* table may not exist yet — fall through and try to fill it */ }

  // 2) Which tickers to fetch (from the client's tracked US list)
  let symbols = String((req.query && req.query.symbols) || "")
    .split(",").map(s => s.trim().toUpperCase()).filter(s => /^[A-Z.]{1,8}$/.test(s));
  symbols = Array.from(new Set(symbols)).slice(0, 80);
  if (!symbols.length) { res.status(400).json({ error: "no symbols" }); return; }

  // 3) Batch fetch from Twelve Data (one request, comma-separated symbols)
  try {
    const url = "https://api.twelvedata.com/time_series?symbol=" + encodeURIComponent(symbols.join(",")) +
      "&interval=1day&outputsize=200&apikey=" + key;
    const data = await (await fetch(url)).json();
    // Single symbol returns {meta,values,status}; multiple returns { SYM: {...}, ... }
    const perSymbol = (data && data.values) ? { [symbols[0]]: data } : (data || {});
    const upserts = [];
    for (const sym of symbols) {
      const e = perSymbol[sym];
      if (e && e.status === "ok" && Array.isArray(e.values)) {
        const prices = e.values.map(v => parseFloat(v.close)).filter(n => Number.isFinite(n) && n > 0).reverse();
        if (prices.length >= 25) upserts.push({ ticker: sym, prices: prices, updated_at: new Date().toISOString() });
      }
    }
    if (upserts.length) {
      await fetch(SUPABASE_URL + "/rest/v1/histories?on_conflict=ticker", {
        method: "POST",
        headers: Object.assign({ "Prefer": "resolution=merge-duplicates" }, SUPA),
        body: JSON.stringify(upserts)
      });
    }
    res.status(200).json({ refreshed: upserts.length, requested: symbols.length });
  } catch (e) {
    res.status(502).json({ error: "refresh failed", detail: String(e).slice(0, 120) });
  }
};
