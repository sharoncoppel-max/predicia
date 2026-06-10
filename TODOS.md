# Predicia — TODOs / Deferred Backlog

Everything from the QA pass and the design review has shipped except the polish
items below. These are low-priority "good → great" refinements, not bugs — the
app is live and correct at https://predicia.vercel.app.

## Remaining (polish)

- [ ] **Replace `transition: all` (3 uses)** with explicit property lists
  (`transition: background .15s ease, transform .15s ease`). Animating `all`
  also animates layout/paint properties and risks minor jank. (`index.html`)

- [ ] **Fold stray accent colors into the `:root` token system.** ~11 hardcoded
  hex/`rgba()` accents live outside the CSS variables (the rest of the palette
  is tokenised). Move them into `:root` so the color system stays single-source.
  (`index.html`)

- [ ] **Finish the spacing-token migration.** `--space-*` tokens now exist and
  fractional font-sizes are gone, but most `padding`/`margin`/`gap` values are
  still literal px. Migrate them to `--space-*` for a fully systematic scale.
  Deliberate refactor — high churn, do it in one focused pass. (`index.html`)

- [ ] **Broaden the responsive strategy (optional).** The concrete mobile bug
  (backtest win-rate bar collapsing to 0px) is fixed and there's no horizontal
  overflow at any breakpoint, but there's still only a single `max-width:600px`
  query. A tablet breakpoint + modal/nav tuning would be a nice-to-have, not a
  fix. (`index.html`)

## Done (for reference)

- QA: confidence cap at 94%, engine version unified to v3.1, 63-vs-66 count
  clarified, 429 rate-limit handling, currency consistency.
- Design: keyboard `:focus-visible` ring, `prefers-reduced-motion` support,
  44px touch targets, `<main>` landmark, Space Grotesk display font, type/spacing
  scale tokens + no fractional font-sizes, mobile backtest-row reflow.
- Infra: prediction math extracted to `engine.js` (single 94%-cap source) with a
  52-test Bun suite; deployed on Vercel (`predicia.vercel.app`).

Full design audit (local artifact, not in repo):
`~/.gstack/projects/sharoncoppel-max-predicia/designs/design-audit-20260609/design-audit-predicia.md`
