// GET /api/leaderboard
// Public read of this season's standings, served from the server (not the raw
// table) so we expose only username + value — never tokens or holdings.
const A = require("../lib/accounts.js");

module.exports = async (req, res) => {
  const H = A.serviceHeaders();
  if (!H) { res.status(500).json({ error: "SUPABASE_SERVICE_KEY not set on the server" }); return; }
  try {
    const m = A.currentMonth();
    const r = await fetch(A.SUPABASE_URL + "/rest/v1/accounts?month=eq." + m + "&order=value.desc&limit=100&select=username,value", { headers: H });
    const rows = r.ok ? await r.json() : [];
    res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=30");
    res.status(200).json(Array.isArray(rows) ? rows : []);
  } catch (e) {
    res.status(200).json([]);  // a flaky board just shows empty, never an error page
  }
};
