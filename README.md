# Predicia

An educational stock-prediction demo. Open `index.html` (served over http so the
live-price fetch works, e.g. `python3 -m http.server`).

## Structure

- `index.html` — the app: data, rendering, live-price fetch, paper trading, UI.
- `engine.js` — the pure prediction math (10 signals, 3 model scorers, confidence).
  Loaded by `index.html` in the browser and imported by the tests. One definition,
  no duplication.

## Tests

The prediction math is unit-tested with [Bun](https://bun.sh)'s built-in runner
(no dependencies to install):

```bash
bun test
```

Covers every signal, the model scorers, and the rule that confidence never exceeds
94% (a regression test for a real bug).
