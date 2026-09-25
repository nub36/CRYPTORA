# CRYPTORA authorial terminal system

Status: frontend redesign pass, 2026-09-25. Not deployed.

## Intent

CRYPTORA is presented as a market-intelligence workstation rather than a collection of SaaS cards. The layout uses a dark canvas, restrained raised surfaces, thin dividers, compact page identity, and tabular numeric typography. Hierarchy comes from rhythm and grouping; borders are reserved for actual interactive or stateful regions.

## Tokens

The implementation lives in `src/index.css` and keeps the existing semantic theme aliases intact.

- Canvas: `--terminal-canvas`
- Surface / raised surface: `--terminal-surface`, `--terminal-raised`
- Divider: `--terminal-divider`
- Primary / secondary / tertiary text: `--terminal-text`, `--terminal-secondary`, `--terminal-tertiary`
- Accent: `--terminal-accent`; positive, negative, warning semantic colors are explicit
- Radius: `--terminal-radius` (6px)
- Data typography: `.ui-num` / `tabular-nums`; labels use `.eyebrow`
- Responsive acceptance: 390px mobile, 640px compact breakpoint, desktop workstation layouts

## Composition primitives

- `.terminal-section` is a single surface boundary for a meaningful region, not a wrapper around every row.
- `.terminal-section__header` pairs a compact identity with one primary state or action.
- `.scope-switch` makes data scope explicit and keyboard-operable.
- Dense rows remain semantic buttons/lists and inherit existing focus and reduced-motion rules.

## Signals architecture

`/signals` has a server-backed global feed by default (`GET /api/signals?limit=20`). It never uses BTC as an implicit feed filter. A selected asset has a separate, bounded history query, activated only after an explicit asset selection or deep link; this avoids an initial request fan-out. Global and current-asset statistics are explicit scopes; the default statistics request has no `symbol`, while the asset scope sends the selected base symbol.

Selecting a row uses the server DTO as the source of truth, writes `/signals?symbol=<BASE>&signal=<id>`, and drives the candle symbol, selected levels, summary, and deep-link identity together. Provenance rules remain server-defined; `MISMATCH` and `UNKNOWN` are not promoted into production notifications.

## Shell

Header and footer retain all routes, actions, auth, search, alert, and legal semantics, while using the compact terminal treatment. Secondary footer navigation remains available but no longer claims the full terminal workspace.
