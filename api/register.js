// POST /api/register  { token, username }
// Creates the player's account the first time (or returns it if the token
// already has one). The token is the browser's secret pass; we store only its
// hash. Username is validated SERVER-side here — that's the check that counts.
const A = require("../lib/accounts.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const H = A.serviceHeaders();
  if (!H) { res.status(500).json({ error: "SUPABASE_SERVICE_KEY not set on the server" }); return; }

  const body = await A.readBody(req);
  const token = String(body.token || "");
  if (token.length < 16) { res.status(400).json({ error: "bad token" }); return; }
  const check = A.cleanUsername(body.username);
  if (!check.ok) { res.status(400).json({ error: check.msg }); return; }

  const tokenHash = A.hashToken(token);
  try {
    const existing = await A.getAccount(H, tokenHash);
    if (existing) {
      // Already registered — let them rename (still their own row only).
      if (existing.username !== check.name) {
        await A.patchAccount(H, existing.id, { username: check.name });
        existing.username = check.name;
      }
      A.applyMonthlyReset(existing);
      res.status(200).json(A.publicState(existing));
      return;
    }
    const row = {
      token_hash: tokenHash, username: check.name, month: A.currentMonth(),
      cash: A.STARTING_CASH, holdings: {}, value: A.STARTING_CASH
    };
    const r = await fetch(A.SUPABASE_URL + "/rest/v1/accounts", {
      method: "POST", headers: Object.assign({ Prefer: "return=representation" }, H), body: JSON.stringify(row)
    });
    if (!r.ok) { res.status(500).json({ error: "create failed", detail: (await r.text()).slice(0, 160) }); return; }
    const created = (await r.json())[0];
    res.status(200).json(A.publicState(created));
  } catch (e) {
    res.status(502).json({ error: "register failed", detail: String(e).slice(0, 120) });
  }
};
