// POST /api/trade  { token, action: "buy"|"sell", ticker, shares }
// The referee. Fetches the REAL price for the traded ticker, validates the
// trade against the server-held cash/holdings, applies it, re-prices the whole
// portfolio, and saves. A score can only ever come from trades that pass here —
// the browser cannot invent cash or shares.
const A = require("../lib/accounts.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const H = A.serviceHeaders();
  if (!H) { res.status(500).json({ error: "SUPABASE_SERVICE_KEY not set on the server" }); return; }

  const body = await A.readBody(req);
  const name = A.cleanUsername(body.username);
  const pin = A.cleanPin(body.pin);
  const action = body.action === "sell" ? "sell" : body.action === "buy" ? "buy" : null;
  const ticker = String(body.ticker || "").trim().toUpperCase();
  const shares = Number(body.shares);

  if (!name.ok || !pin) { res.status(400).json({ error: "bad login" }); return; }
  if (!action) { res.status(400).json({ error: "action must be buy or sell" }); return; }
  if (!/^[A-Z.]{1,8}$/.test(ticker)) { res.status(400).json({ error: "bad ticker" }); return; }
  if (!(shares > 0) || !Number.isFinite(shares)) { res.status(400).json({ error: "shares must be > 0" }); return; }

  try {
    const acct = await A.getAccount(H, A.deriveKey(name.name, pin));
    if (!acct) { res.status(404).json({ error: "log in first" }); return; }
    A.applyMonthlyReset(acct);
    acct.holdings = acct.holdings || {};

    // Real price for the traded ticker: live quote first, then cached close.
    let price = await A.liveQuote(ticker);
    if (!(price > 0)) {
      const cached = await A.cachedPrices(H, [ticker]);
      price = cached[ticker];
    }
    if (!(price > 0)) { res.status(400).json({ error: "no real price for " + ticker }); return; }

    if (action === "buy") {
      const cost = shares * price;
      if (cost > acct.cash + 0.005) { res.status(400).json({ error: "not enough cash" }); return; }
      acct.cash = Number(acct.cash) - cost;
      const pos = acct.holdings[ticker] || { shares: 0, totalCost: 0 };
      pos.shares += shares;
      pos.totalCost += cost;
      if (body.name) pos.name = String(body.name).slice(0, 60);
      acct.holdings[ticker] = pos;
    } else {
      const pos = acct.holdings[ticker];
      if (!pos || pos.shares < shares - 0.0001) { res.status(400).json({ error: "you don't own that many shares" }); return; }
      acct.cash = Number(acct.cash) + shares * price;
      const ratio = shares / pos.shares;
      pos.totalCost -= pos.totalCost * ratio;
      pos.shares -= shares;
      if (pos.shares < 0.0001) delete acct.holdings[ticker];
    }

    const prices = await A.cachedPrices(H, Object.keys(acct.holdings));
    const value = A.computeValue(acct, prices, { ticker, price });
    acct.value = value;
    const w = await A.patchAccount(H, acct.id, { cash: acct.cash, holdings: acct.holdings, value, month: acct.month });
    if (!w.ok) { res.status(500).json({ error: "save failed" }); return; }
    res.status(200).json(A.publicState(acct));
  } catch (e) {
    res.status(502).json({ error: "trade failed", detail: String(e).slice(0, 120) });
  }
};
