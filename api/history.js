// Vercel serverless function — real daily price history for a ticker.
// Proxies Twelve Data's time_series so the API key stays server-side. Returns
// { symbol, prices: [...] } with ~40-60 daily closes, oldest first — exactly the
// shape Predicia's signals expect. This is what lets searched companies get a
// REAL prediction (real momentum/trend/etc.), not a made-up one.
module.exports = async (req, res) => {
  const symbol = String((req.query && req.query.symbol) || "").trim().toUpperCase();
  if (!symbol || !/^[A-Z.]{1,8}$/.test(symbol)) {
    res.status(400).json({ error: "bad symbol" });
    return;
  }
  const key = process.env.TWELVE_DATA_KEY;
  if (!key) {
    res.status(500).json({ error: "TWELVE_DATA_KEY not set on the server" });
    return;
  }
  try {
    const upstream = await fetch(
      "https://api.twelvedata.com/time_series?symbol=" + encodeURIComponent(symbol) +
      "&interval=1day&outputsize=60&apikey=" + key
    );
    const data = await upstream.json();
    if (!data || data.status !== "ok" || !Array.isArray(data.values)) {
      // Twelve Data returns { status:"error", message } for bad symbol / rate limit
      res.status(404).json({ error: "no history", detail: (data && data.message) || null });
      return;
    }
    // values are newest-first; Predicia wants closes oldest-first
    const prices = data.values
      .map(v => parseFloat(v.close))
      .filter(n => Number.isFinite(n) && n > 0)
      .reverse();
    if (prices.length < 25) {
      res.status(404).json({ error: "not enough history" });
      return;
    }
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400"); // prices change slowly; cache 1h
    res.status(200).json({ symbol: symbol, prices: prices });
  } catch (e) {
    res.status(502).json({ error: "history fetch failed" });
  }
};
