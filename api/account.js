// POST /api/account  { token }
// Returns the player's current server-held state (cash, holdings, value, month),
// applying a fresh-season reset if the month rolled over and re-pricing the
// portfolio from the cached closes so the leaderboard value stays current.
const A = require("../lib/accounts.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const H = A.serviceHeaders();
  if (!H) { res.status(500).json({ error: "SUPABASE_SERVICE_KEY not set on the server" }); return; }

  const body = await A.readBody(req);
  const token = String(body.token || "");
  if (token.length < 16) { res.status(400).json({ error: "bad token" }); return; }

  try {
    const acct = await A.getAccount(H, A.hashToken(token));
    if (!acct) { res.status(404).json({ error: "no account" }); return; }
    const reset = A.applyMonthlyReset(acct);
    const prices = await A.cachedPrices(H, Object.keys(acct.holdings || {}));
    const value = A.computeValue(acct, prices);
    // Persist if the value moved or we reset the season.
    if (reset || Math.abs(value - Number(acct.value)) > 0.005) {
      await A.patchAccount(H, acct.id, { cash: acct.cash, holdings: acct.holdings, value, month: acct.month });
      acct.value = value;
    }
    res.status(200).json(A.publicState(acct));
  } catch (e) {
    res.status(502).json({ error: "account failed", detail: String(e).slice(0, 120) });
  }
};
