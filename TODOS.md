# Predicia — TODOs / Backlog

Everything from the QA pass and the design review has shipped. The polish
backlog below is now cleared. App is live at https://predicia.vercel.app.

## Polish backlog — DONE

- [x] **Replace `transition: all` (3 uses)** with explicit non-layout property
  lists (`background-color, border-color, color, transform, box-shadow`). — `af08c5f`

- [x] **Fold stray accent colors into `:root` tokens** — `--accent-amber`,
  `--model-predicia/-graham/-carhart`, `--border-strong`. All CSS usages now
  reference vars (JS confetti palette stays literal). — `af08c5f`

- [x] **Tokenize on-scale spacing** — 43 single-value `padding/margin/gap`
  declarations matching the scale (4/8/12/16/20/24/32px) now use `--space-*`
  (lossless). The intentional 2px rhythm (6/10/14/18/22px) is left literal by
  design so the token set stays clean. — `d4aed80`

- [x] **Broader responsive** — verified, no change needed. Tested at
  375/390/768/820/1280px: no overflow, fluid `auto-fit` grids reflow cleanly,
  modal + detail view hold up. The single mobile breakpoint plus fluid grids
  already cover the range; a tablet breakpoint would be gratuitous.

## Done earlier (for reference)

- QA: confidence cap at 94%, engine version unified to v3.1, 63-vs-66 count
  clarified, 429 rate-limit handling, currency consistency.
- Design: keyboard `:focus-visible` ring, `prefers-reduced-motion` support,
  44px touch targets, `<main>` landmark, Space Grotesk display font, type/spacing
  scale tokens + no fractional font-sizes, mobile backtest-row reflow.
- Infra: prediction math extracted to `engine.js` (single 94%-cap source) with a
  52-test Bun suite; deployed on Vercel (`predicia.vercel.app`).

Full design audit (local artifact, not in repo):
`~/.gstack/projects/sharoncoppel-max-predicia/designs/design-audit-20260609/design-audit-predicia.md`
