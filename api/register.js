// POST /api/register  { username, pin }
// Acts as LOGIN-OR-CREATE:
//  - If (username + PIN) matches an existing account → log in (return its state).
//  - If that username exists but the PIN doesn't match → "check your PIN".
//  - If the username is brand new → create the account.
// Identity is derived from username+PIN (see deriveKey), so the same pair
// restores the same account on any device, and we never store the PIN itself.
const A = require("../lib/accounts.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const H = A.serviceHeaders();
  if (!H) { res.status(500).json({ error: "SUPABASE_SERVICE_KEY not set on the server" }); return; }

  const body = await A.readBody(req);
  const check = A.cleanUsername(body.username);
  if (!check.ok) { res.status(400).json({ error: check.msg }); return; }
  const pin = A.cleanPin(body.pin);
  if (!pin) { res.status(400).json({ error: "Your PIN must be 4 to 6 numbers." }); return; }

  const key = A.deriveKey(check.name, pin);
  try {
    // Exact match on username + PIN → that's your account, log in.
    const existing = await A.getAccount(H, key);
    if (existing) {
      A.applyMonthlyReset(existing);
      res.status(200).json(A.publicState(existing));
      return;
    }
    // No match. Is the name already taken (by someone with a different PIN)?
    const rows = await A.findByUsername(H, check.name);
    if (rows.some(r => r.token_hash !== key)) {
      res.status(409).json({ error: "That name is taken. If it's yours, check your PIN — otherwise pick a different name." });
      return;
    }
    // Brand-new player → create the account.
    const row = {
      token_hash: key, username: check.name, month: A.currentMonth(),
      cash: A.STARTING_CASH, holdings: {}, value: A.STARTING_CASH
    };
    const r = await fetch(A.SUPABASE_URL + "/rest/v1/accounts", {
      method: "POST", headers: Object.assign({ Prefer: "return=representation" }, H), body: JSON.stringify(row)
    });
    if (!r.ok) { res.status(500).json({ error: "create failed", detail: (await r.text()).slice(0, 160) }); return; }
    res.status(200).json(A.publicState((await r.json())[0]));
  } catch (e) {
    res.status(502).json({ error: "login failed", detail: String(e).slice(0, 120) });
  }
};
