// Unit tests for the Predicia prediction engine (engine.js).
// Run with: bun test
//
// engine.js is the single source of truth for the prediction math — the same
// file index.html loads in the browser. Testing it here means the math the
// real app runs is the math under test.

import { describe, expect, test } from "bun:test";
import * as engine from "./engine.js";

const {
  seededRandom,
  calcMomentum, calcTrend, calcCalmness, calcNews, calcSectorStrength,
  calcRangePosition, calcStreak, calcMACross, calcAnalystRating, calcSocialBuzz,
  buildSignals,
  WEIGHTS, scorePredicia, scoreGrahamValue, scoreCarhartMomentum,
  verdictFromScore, confidenceFromScore,
  priceAt, valueHoldingsAt, benchmarkValueAt, pctReturn,
} = engine;

// --- fixtures ---------------------------------------------------------------
const rising  = Array.from({ length: 30 }, (_, i) => 100 + i);       // 100..129
const falling = Array.from({ length: 30 }, (_, i) => 130 - i);       // 130..101
const flat    = Array.from({ length: 30 }, () => 100);
// accelerating: gentle early, steep last 5 days → positive momentum
const accel   = [...Array.from({ length: 25 }, (_, i) => 100 + i * 0.2), 106, 109, 113, 118, 124];

const inRange = (x) => x >= -1 && x <= 1;

// --- seeded random ----------------------------------------------------------
describe("seededRandom", () => {
  test("is deterministic for the same seed", () => {
    const a = seededRandom(42), b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  test("different seeds diverge", () => {
    expect(seededRandom(1)()).not.toBe(seededRandom(2)());
  });
  test("stays in [0,1)", () => {
    const r = seededRandom(7);
    for (let i = 0; i < 50; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// --- signals: bounds + direction -------------------------------------------
describe("signal bounds", () => {
  const fns = { calcMomentum, calcTrend, calcCalmness, calcRangePosition, calcStreak, calcMACross };
  for (const [name, fn] of Object.entries(fns)) {
    test(`${name} stays in [-1,1]`, () => {
      for (const series of [rising, falling, flat, accel]) expect(inRange(fn(series))).toBe(true);
    });
  }
});

describe("calcMomentum", () => {
  test("accelerating series is positive", () => expect(calcMomentum(accel)).toBeGreaterThan(0));
  test("flat series is ~0", () => expect(calcMomentum(flat)).toBeCloseTo(0, 5));
});

describe("calcTrend", () => {
  test("rising above its MA is positive", () => expect(calcTrend(rising)).toBeGreaterThan(0));
  test("falling below its MA is negative", () => expect(calcTrend(falling)).toBeLessThan(0));
  test("flat is exactly 0", () => expect(calcTrend(flat)).toBe(0));
});

describe("calcRangePosition", () => {
  test("price at range high = +1", () => expect(calcRangePosition(rising)).toBe(1));
  test("price at range low = -1", () => expect(calcRangePosition(falling)).toBe(-1));
  test("flat (no range) = 0", () => expect(calcRangePosition(flat)).toBe(0));
});

describe("calcStreak", () => {
  test("long up streak caps at +1", () => expect(calcStreak(rising)).toBe(1));
  test("long down streak caps at -1", () => expect(calcStreak(falling)).toBe(-1));
  test("3-day up streak = 3/5 strength", () => {
    expect(calcStreak([100, 99, 98, 99, 100, 101])).toBeCloseTo(0.6, 5);
  });
});

describe("calcMACross", () => {
  test("short MA above long MA is positive", () => expect(calcMACross(rising)).toBeGreaterThan(0));
  test("flat = 0", () => expect(calcMACross(flat)).toBe(0));
});

describe("calcNews", () => {
  test("no events = 0", () => expect(calcNews([])).toBe(0));
  test("all positive = +1", () => expect(calcNews([{ tag: "pos" }, { tag: "pos" }])).toBe(1));
  test("all negative = -1", () => expect(calcNews([{ tag: "neg" }, { tag: "neg" }])).toBe(-1));
  test("mixed averages out", () => {
    expect(calcNews([{ tag: "pos" }, { tag: "pos" }, { tag: "neg" }])).toBeCloseTo(1 / 3, 5);
  });
});

describe("calcCalmness", () => {
  test("sign follows the trend (smooth rise is positive)", () => {
    expect(calcCalmness(rising)).toBeGreaterThan(0);
    expect(calcCalmness(falling)).toBeLessThan(0);
  });
});

describe("calcSectorStrength", () => {
  const co = { ticker: "AAA", sector: "Tech", prices: rising };
  test("no peers = 0", () => {
    expect(calcSectorStrength(co, [co])).toBe(0);
  });
  test("rising peers in same sector are a tailwind (positive)", () => {
    const peers = [co, { ticker: "BBB", sector: "Tech", prices: rising }, { ticker: "CCC", sector: "Tech", prices: rising }];
    expect(calcSectorStrength(co, peers)).toBeGreaterThan(0);
  });
  test("ignores other sectors", () => {
    const peers = [co, { ticker: "ZZZ", sector: "Food", prices: rising }];
    expect(calcSectorStrength(co, peers)).toBe(0); // no Tech peers besides self
  });
});

describe("seeded signals (analyst, buzz)", () => {
  const co = { seed: 5, trend: 0.004 };
  test("analyst rating is deterministic and bounded", () => {
    expect(calcAnalystRating(co)).toBe(calcAnalystRating(co));
    expect(inRange(calcAnalystRating(co))).toBe(true);
  });
  test("social buzz is deterministic and bounded", () => {
    expect(calcSocialBuzz(co)).toBe(calcSocialBuzz(co));
    expect(inRange(calcSocialBuzz(co))).toBe(true);
  });
});

// --- signal vector assembly -------------------------------------------------
describe("buildSignals", () => {
  const co = { seed: 3, trend: 0.003, events: [{ tag: "pos" }, { tag: "neg" }], prices: rising };
  test("returns all 10 signal keys", () => {
    const s = buildSignals(co, rising, 0.2);
    expect(Object.keys(s).sort()).toEqual(
      ["analyst", "buzz", "calmness", "cross", "momentum", "news", "rangePos", "sector", "streak", "trend"].sort()
    );
  });
  test("passes sectorVal through verbatim", () => {
    expect(buildSignals(co, rising, 0.42).sector).toBe(0.42);
  });
  test("wires each signal to its calc fn for the given window", () => {
    const s = buildSignals(co, rising, 0);
    expect(s.trend).toBe(calcTrend(rising));
    expect(s.rangePos).toBe(calcRangePosition(rising));
    expect(s.news).toBe(calcNews(co.events));
  });
});

// --- weights + scoring ------------------------------------------------------
describe("WEIGHTS", () => {
  test("sum to exactly 1.0", () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

const ones = { momentum: 1, trend: 1, news: 1, sector: 1, rangePos: 1, streak: 1, cross: 1, analyst: 1, buzz: 1, calmness: 1 };
const zeros = Object.fromEntries(Object.keys(ones).map((k) => [k, 0]));

describe("model scorers", () => {
  test("scorePredicia of all-ones = sum of weights = 1.0", () => {
    expect(scorePredicia(ones)).toBeCloseTo(1.0, 10);
  });
  test("scorePredicia of all-zeros = 0", () => expect(scorePredicia(zeros)).toBe(0));
  test("scoreCarhartMomentum of all-ones = 1.0 (weights sum to 1)", () => {
    expect(scoreCarhartMomentum(ones)).toBeCloseTo(1.0, 10);
  });
  test("scoreGrahamValue inverts rangePos and streak", () => {
    // 0.22+0.22+0.20+0.18 - 0.10 - 0.08 = 0.64
    expect(scoreGrahamValue(ones)).toBeCloseTo(0.64, 10);
  });
});

describe("verdictFromScore", () => {
  test("above +0.10 = up", () => expect(verdictFromScore(0.11)).toBe("up"));
  test("below -0.10 = down", () => expect(verdictFromScore(-0.11)).toBe("down"));
  test("inside the band = neutral", () => expect(verdictFromScore(0.05)).toBe("neutral"));
  test("exactly +0.10 is neutral (boundary is exclusive)", () => expect(verdictFromScore(0.10)).toBe("neutral"));
  test("exactly -0.10 is neutral", () => expect(verdictFromScore(-0.10)).toBe("neutral"));
});

// --- season game math --------------------------------------------------------
describe("season math", () => {
  // A doubles by day 2, B stays flat.
  const A = { ticker: "A", prices: [10, 10, 20] };
  const B = { ticker: "B", prices: [10, 10, 10] };
  const cos = [A, B];

  describe("priceAt", () => {
    test("returns the price at the index", () => expect(priceAt(A, 2)).toBe(20));
    test("clamps above the range to the last price", () => expect(priceAt(A, 99)).toBe(20));
    test("clamps below the range to the first price", () => expect(priceAt(A, -5)).toBe(10));
    test("empty prices = 0", () => expect(priceAt({ ticker: "X", prices: [] }, 0)).toBe(0));
  });

  describe("valueHoldingsAt", () => {
    test("no holdings = 0", () => expect(valueHoldingsAt({}, cos, 2)).toBe(0));
    test("values one holding at the day price", () =>
      expect(valueHoldingsAt({ A: { shares: 2 } }, cos, 2)).toBe(40)); // 2 * 20
    test("sums multiple holdings", () =>
      expect(valueHoldingsAt({ A: { shares: 1 }, B: { shares: 3 } }, cos, 2)).toBe(20 + 30));
    test("ignores zero-share entries", () =>
      expect(valueHoldingsAt({ A: { shares: 0 } }, cos, 2)).toBe(0));
  });

  describe("benchmarkValueAt", () => {
    test("at startDay equals the starting cash", () =>
      expect(benchmarkValueAt(100, cos, 0, 0)).toBeCloseTo(100, 9));
    test("equal-weight: A doubles, B flat => +50%", () =>
      expect(benchmarkValueAt(100, cos, 0, 2)).toBeCloseTo(150, 9)); // 50*2 + 50*1
    test("skips a company with a zero start price (no divide-by-zero)", () => {
      const C = { ticker: "C", prices: [0, 0, 5] };
      expect(benchmarkValueAt(100, [A, C], 0, 2)).toBeCloseTo(100, 9); // only A counts: 50*2
    });
  });

  describe("pctReturn", () => {
    test("gain", () => expect(pctReturn(150, 100)).toBeCloseTo(50, 9));
    test("loss", () => expect(pctReturn(50, 100)).toBeCloseTo(-50, 9));
    test("flat", () => expect(pctReturn(100, 100)).toBe(0));
    test("zero start is guarded", () => expect(pctReturn(100, 0)).toBe(0));
  });
});

// --- confidence cap: regression for the QA fix ------------------------------
// Regression: ISSUE-001 — cards showed "Confidence 100%" / model pills 99.9%,
// contradicting the documented "Predicia never says more than 94% sure".
// Found by /qa on 2026-06-09. Report: .gstack/qa-reports/qa-report-predicia-2026-06-09.md
describe("confidenceFromScore — never exceeds the documented 94% cap", () => {
  test("a maxed score is capped at 0.94, not 1.0", () => {
    expect(confidenceFromScore(1)).toBe(0.94);
  });
  test("an absurdly large score is still capped at 0.94", () => {
    expect(confidenceFromScore(100)).toBe(0.94);
  });
  test("no score in a wide sweep ever yields more than 0.94", () => {
    for (let score = -5; score <= 5; score += 0.01) {
      expect(confidenceFromScore(score)).toBeLessThanOrEqual(0.94);
    }
  });
  test("zero score = zero confidence", () => expect(confidenceFromScore(0)).toBe(0));
  test("small score scales linearly below the cap", () => {
    expect(confidenceFromScore(0.1)).toBeCloseTo(0.1 * 4.5 * 1.05, 10);
  });
  test("dampening pulls confidence down", () => {
    expect(confidenceFromScore(0.1, 0.5)).toBeCloseTo(0.1 * 4.5 * 1.05 * 0.5, 10);
  });
  test("is symmetric in score sign", () => {
    expect(confidenceFromScore(0.15)).toBeCloseTo(confidenceFromScore(-0.15), 10);
  });
});
