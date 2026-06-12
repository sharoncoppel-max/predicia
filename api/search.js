// Vercel serverless function — search the whole stock market by name or ticker.
// Proxies Finnhub's symbol lookup so the API key stays server-side. Returns a
// short list of US common stocks: [{ symbol, name }].
module.exports = async (req, res) => {
  const q = String((req.query && req.query.q) || "").trim();
  if (!q || q.length > 40) {
    res.status(400).json({ error: "bad query" });
    return;
  }
  const key = process.env.FINNHUB_KEY;
  if (!key) {
    res.status(500).json({ error: "FINNHUB_KEY not set on the server" });
    return;
  }
  try {
    const upstream = await fetch(
      "https://finnhub.io/api/v1/search?q=" + encodeURIComponent(q) + "&token=" + key
    );
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: "upstream error" });
      return;
    }
    const data = await upstream.json();
    const results = (data.result || [])
      // US common stocks with a clean ticker (no dots/colons for foreign listings)
      .filter(r => r.type === "Common Stock" && /^[A-Z]{1,6}$/.test(r.symbol))
      .slice(0, 8)
      .map(r => ({ symbol: r.symbol, name: r.description }));
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json(results);
  } catch (e) {
    res.status(502).json({ error: "search failed" });
  }
};
