/* ============================================================
   Predicia Engine — pure prediction math (single source of truth)
   ============================================================
   These functions are stateless: every input arrives as an argument,
   nothing here touches the DOM, the network, or global app state.

   Loaded two ways:
     - In the browser, index.html includes <script src="engine.js"></script>
       BEFORE its inline script, so every function below is a global the
       app code calls directly (calcMomentum, scorePredicia, ...).
     - In tests, engine.test.js does require('./engine.js') and gets the
       same functions via the module.exports block at the bottom.

   Keeping one copy is deliberate: the 94% confidence cap used to live in
   two places and drifted. One definition = it can't drift again.
   ============================================================ */

/* ---------- SEEDED RANDOM ----------
   Tiny seeded random number generator. Same seed always gives same sequence,
   so prices and seeded signals stay stable across refreshes. */
function seededRandom(seed) {
  let s = seed * 9301 + 49297;
  return function () {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/* ---------- SIGNALS ----------
   10 signals, each returns a number from -1 (very bearish) to +1 (very
   bullish). They get combined with weights to make a Predicia Score. */

// 1. MOMENTUM — last 5 days return vs the previous 25 days
function calcMomentum(prices) {
  const last5Start = prices[prices.length - 6];
  const last5End = prices[prices.length - 1];
  const last5Return = (last5End - last5Start) / last5Start;
  const prev25Start = prices[0];
  const prev25End = prices[prices.length - 6];
  const prev25Return = (prev25End - prev25Start) / prev25Start;
  const raw = last5Return - prev25Return * (5 / 25);
  return Math.max(-1, Math.min(1, raw * 30));
}

// 2. TREND — is the price above its 20-day moving average?
function calcTrend(prices) {
  const last20 = prices.slice(-20);
  const avg = last20.reduce((s, p) => s + p, 0) / 20;
  const current = prices[prices.length - 1];
  const diff = (current - avg) / avg;
  return Math.max(-1, Math.min(1, diff * 20));
}

// 3. CALMNESS — smoother stocks are more predictable
function calcCalmness(prices) {
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stdev = Math.sqrt(variance);
  const calmness = 1 - Math.min(1, stdev * 40);
  return calmness * Math.sign(calcTrend(prices));
}

// 4. NEWS — average sentiment of recent events
function calcNews(events) {
  if (!events.length) return 0;
  let total = 0;
  for (const e of events) {
    if (e.tag === "pos") total += 1;
    else if (e.tag === "neg") total -= 1;
  }
  return Math.max(-1, Math.min(1, total / events.length));
}

// 5. SECTOR STRENGTH — how the rest of the same sector is doing
// (If all gaming stocks are up, that's a tailwind for this gaming stock)
function calcSectorStrength(company, allCompanies) {
  const peers = allCompanies.filter(c => c.sector === company.sector && c.ticker !== company.ticker);
  if (peers.length === 0) return 0;
  let total = 0;
  for (const p of peers) {
    const r = (p.prices[p.prices.length - 1] - p.prices[0]) / p.prices[0];
    total += r;
  }
  const avg = total / peers.length;
  return Math.max(-1, Math.min(1, avg * 12));
}

// 6. RANGE POSITION — where is the current price in the 30-day high-low range?
// Near top of range = strong (bullish), near bottom = weak (bearish)
function calcRangePosition(prices) {
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const current = prices[prices.length - 1];
  if (max === min) return 0;
  const pos = (current - min) / (max - min); // 0..1
  return (pos - 0.5) * 2; // -1..+1
}

// 7. STREAK — consecutive up or down days
// Multiple up days in a row = strong signal in that direction
function calcStreak(prices) {
  if (prices.length < 2) return 0;
  const lastDir = prices[prices.length - 1] > prices[prices.length - 2] ? 1 : -1;
  let count = 0;
  for (let i = prices.length - 1; i > 0; i--) {
    const dir = prices[i] > prices[i - 1] ? 1 : -1;
    if (dir === lastDir) count++;
    else break;
  }
  const magnitude = Math.min(1, count / 5); // 5+ days = full strength
  return lastDir * magnitude;
}

// 8. MA CROSS — short-term moving average vs long-term (the famous "Golden Cross")
// When short MA is above long MA, that's bullish. Real traders watch this every day.
function calcMACross(prices) {
  const short = prices.slice(-5).reduce((s, p) => s + p, 0) / 5;
  const long = prices.slice(-20).reduce((s, p) => s + p, 0) / 20;
  const diff = (short - long) / long;
  return Math.max(-1, Math.min(1, diff * 30));
}

// 9. ANALYST RATING — simulated consensus from Wall Street analysts
// In real life this comes from a survey of analysts at different banks.
// Here it's seeded so it stays stable, biased toward the company's trend.
function calcAnalystRating(company) {
  const rng = seededRandom(company.seed + 1000);
  const trendBias = company.trend * 90;
  const noise = (rng() - 0.5) * 0.7;
  return Math.max(-1, Math.min(1, trendBias + noise));
}

// 10. SOCIAL BUZZ — search & social media mention trends
// Real systems use Google Trends, Reddit, X (Twitter) mention volume.
function calcSocialBuzz(company) {
  const rng = seededRandom(company.seed + 2000);
  const momentumProxy = company.trend * 70;
  const noise = (rng() - 0.5) * 1.4;
  return Math.max(-1, Math.min(1, momentumProxy + noise));
}

// Assemble the 10-signal vector for one company over a given price window.
// `sectorVal` is passed in because the live view and the historical backtest
// compute sector strength differently (current peers vs peers-at-day-d); every
// other signal is identical, so this is the one place the vector is built.
function buildSignals(company, win, sectorVal) {
  return {
    momentum: calcMomentum(win),
    trend:    calcTrend(win),
    news:     calcNews(company.events),
    sector:   sectorVal,
    rangePos: calcRangePosition(win),
    streak:   calcStreak(win),
    cross:    calcMACross(win),
    analyst:  calcAnalystRating(company),
    buzz:     calcSocialBuzz(company),
    calmness: calcCalmness(win)
  };
}

/* ---------- SCORING ---------- */

const WEIGHTS = {
  momentum: 0.14,
  trend:    0.13,
  news:     0.13,
  sector:   0.11,
  rangePos: 0.10,
  streak:   0.08,
  cross:    0.09,
  analyst:  0.12,
  buzz:     0.05,
  calmness: 0.05
};

// MODEL 1: PREDICIA MULTI-FACTOR — weighted sum of all 10 signals.
function scorePredicia(s) {
  let total = 0;
  for (const k in WEIGHTS) total += WEIGHTS[k] * s[k];
  return total;
}

// MODEL 2: GRAHAM VALUE — mean reversion + quality
// Inspired by: Benjamin Graham (1934), Fama-French HML value factor (1993),
// DeBondt-Thaler long-term reversal (1985). The contrarian model: buys
// stocks that have dropped, in healthy sectors, with quality (low vol).
// INVERTS momentum/range/streak — value investors don't chase hot stocks.
function scoreGrahamValue(s) {
  return (
      0.22 * s.sector       // Sector health — Fama-French SMB cousin
    + 0.22 * s.analyst      // Wall Street consensus
    + 0.20 * s.news         // Fundamental news shifts
    + 0.18 * s.calmness     // Quality = low volatility
    + 0.10 * (-s.rangePos)  // INVERTED — prefers near 30-day lows
    + 0.08 * (-s.streak)    // INVERTED — buy after pullback
  );
}

// MODEL 3: CARHART MOMENTUM — trend following / technical
// Inspired by: Carhart 4-factor (1997), Jegadeesh-Titman 12-month momentum
// (1993), modern CTA / managed futures. The trend follower: buys what's
// hot, ignores fundamentals. Famously profitable over 3-12 month horizons.
function scoreCarhartMomentum(s) {
  return (
      0.28 * s.momentum     // Jegadeesh-Titman core signal
    + 0.18 * s.cross        // Golden cross / death cross
    + 0.14 * s.streak       // Streak persistence
    + 0.14 * s.trend        // Trend vs MA
    + 0.12 * s.rangePos     // Near highs = strong
    + 0.08 * s.buzz         // Behavioral / retail flow
    + 0.06 * s.news         // Light news weight
  );
}

function verdictFromScore(score) {
  if (score > 0.10) return "up";
  if (score < -0.10) return "down";
  return "neutral";
}

// Confidence from a model score. `dampening` (default 1.0) lets longer
// horizons / weaker models pull confidence down. Capped at 0.94 to match
// the documented promise that Predicia never claims more than 94% certainty.
function confidenceFromScore(score, dampening) {
  let c = Math.abs(score) * 4.5 * 1.05;
  c *= (dampening || 1.0);
  return Math.min(0.94, c);
}

/* ---------- SEASON GAME MATH ("Beat the Market") ----------
   Pure helpers the season game runs on. All deterministic: prices come from the
   seeded history (company.prices), so the same season always plays the same. */

// Seeded close price for a company at a day index, clamped to the valid range
// (so advancing past the end or before the start can never read out of bounds).
function priceAt(company, dayIndex) {
  const p = company && company.prices;
  if (!p || !p.length) return 0;
  const i = Math.max(0, Math.min(dayIndex, p.length - 1));
  return p[i];
}

// Total dollar value of holdings at a given day. holdings: { TICKER: { shares } }.
function valueHoldingsAt(holdings, companies, dayIndex) {
  let total = 0;
  for (const ticker in holdings) {
    const shares = (holdings[ticker] && holdings[ticker].shares) || 0;
    if (!shares) continue;
    const c = companies.find(co => co.ticker === ticker);
    if (c) total += shares * priceAt(c, dayIndex);
  }
  return total;
}

// Value at `dayIndex` of an equal-weight "bought everything at startDay" basket.
// This is the market benchmark the player races. Skips any company whose start
// price is missing/zero so it can't divide by zero.
function benchmarkValueAt(startCash, companies, startDay, dayIndex) {
  const n = companies.length;
  if (!n) return startCash;
  const perCompany = startCash / n;
  let total = 0;
  for (const c of companies) {
    const p0 = priceAt(c, startDay);
    if (p0 > 0) total += perCompany * (priceAt(c, dayIndex) / p0);
  }
  return total;
}

// Percent gain/loss from a starting value. Guards a zero/negative start.
function pctReturn(now, start) {
  if (!start || start <= 0) return 0;
  return ((now - start) / start) * 100;
}

/* ---------- EXPORTS ----------
   Browser: `module` is undefined, so this block is skipped and the
   functions above stay as globals. Tests: require('./engine.js') reads
   these. `typeof module` never throws even when module is absent. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    seededRandom,
    calcMomentum, calcTrend, calcCalmness, calcNews, calcSectorStrength,
    calcRangePosition, calcStreak, calcMACross, calcAnalystRating, calcSocialBuzz,
    buildSignals,
    WEIGHTS, scorePredicia, scoreGrahamValue, scoreCarhartMomentum,
    verdictFromScore, confidenceFromScore,
    priceAt, valueHoldingsAt, benchmarkValueAt, pctReturn
  };
}
