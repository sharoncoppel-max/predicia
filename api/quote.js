// Vercel serverless function — proxies Finnhub quote requests so the API key
// stays server-side. The key lives in the FINNHUB_KEY environment variable
// (set in the Vercel dashboard, NOT committed), never in the client bundle.
//
// The static site calls /api/quote?symbol=AAPL and gets back { "c": <price> }.
// CommonJS on purpose: package.json is .vercelignore'd, so there's no
// "type":"module" to make ESM safe here.
module.exports = async (req, res) => {
  const raw = (req.query && req.query.symbol) || "";
  const symbol = String(raw).trim().toUpperCase();
  // Finnhub tickers are letters/digits with an optional dot (e.g. BRK.A).
  // Reject anything else so the key can't be used to hit arbitrary URLs.
  if (!symbol || !/^[A-Z0-9.]{1,12}$/.test(symbol)) {
    res.status(400).json({ error: "invalid symbol" });
    return;
  }

  const key = process.env.FINNHUB_KEY;
  if (!key) {
    // Misconfiguration, not the client's fault — surface it clearly.
    res.status(500).json({ error: "FINNHUB_KEY not set on the server" });
    return;
  }

  try {
    const upstream = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`
    );
    if (upstream.status === 429) {
      res.status(429).json({ error: "rate limited" });
      return;
    }
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: "upstream error" });
      return;
    }
    const data = await upstream.json();
    // Cache at the CDN edge for 60s so repeat lookups don't re-hit Finnhub
    // (also softens the rate limit the whole proxy exists to manage).
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ c: typeof data.c === "number" ? data.c : null });
  } catch (e) {
    res.status(502).json({ error: "fetch failed" });
  }
};
