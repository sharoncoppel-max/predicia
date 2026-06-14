// GET /api/wolfram?q=...   → trustworthy math/money answers from Wolfram|Alpha.
// The App ID stays server-side (never shipped to the browser), same as the
// other keys. Free non-commercial tier is ~2,000 questions/month.
//
// Returns { ok, pods:[{title, text}] } on success, or { ok:false, message }
// when Wolfram can't parse the question.
module.exports = async (req, res) => {
  const appid = process.env.WOLFRAM_APP_ID;
  if (!appid) { res.status(500).json({ error: "WOLFRAM_APP_ID not set on the server" }); return; }

  const q = String((req.query && req.query.q) || "").trim().slice(0, 200);
  if (!q) { res.status(400).json({ error: "ask a question" }); return; }

  try {
    const url = "https://api.wolframalpha.com/v2/query?appid=" + encodeURIComponent(appid) +
      "&input=" + encodeURIComponent(q) +
      "&format=plaintext&output=json&podstate=Result";
    const r = await fetch(url);
    if (!r.ok) {
      const body = (await r.text().catch(() => "")).slice(0, 200);
      res.status(502).json({ error: "wolfram unavailable", upstreamStatus: r.status, detail: body });
      return;
    }
    const data = await r.json();
    const qr = data && data.queryresult;
    if (!qr || !qr.success) {
      res.status(200).json({ ok: false, message: "Hmm, I couldn't work that one out. Try rephrasing — e.g. \"invest 25 a month for 11 years at 8%\" or \"compound interest on 500 at 7% for 10 years\"." });
      return;
    }
    const pods = (qr.pods || [])
      .map(p => ({
        title: p.title || "",
        text: (p.subpods || []).map(s => (s.plaintext || "").trim()).filter(Boolean).join("\n")
      }))
      .filter(p => p.text)
      .slice(0, 6);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800"); // same question, cached
    res.status(200).json({ ok: true, query: q, pods });
  } catch (e) {
    res.status(502).json({ error: "wolfram failed" });
  }
};

// redeploy: load WOLFRAM_APP_ID 133940

// redeploy 134627
