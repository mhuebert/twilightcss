# Twilight — a minimal synchronous Tailwind v4 runtime engine

_Plan authored 2026-08-03. Tailwind v4 current at 4.3.3. Branch: `twilight`._

## Thesis

A runtime CSS engine that gives the "twind experience" — call `tw("flex px-4 hover:bg-red-500/50")`,
get correct CSS, no build step — but with **Tailwind v4 semantics**, radically smaller and faster
than the alternatives, and **provably correct** via differential testing against the real Tailwind
compiler.

Why this is newly feasible: **Tailwind v4 moved the theme out of JavaScript and into CSS custom
properties.** twind and UnoCSS embed the resolved theme (every color hex, every spacing value) as
JS data. A v4-native engine ships the `@theme` block as static CSS and emits only `var()`
references at runtime:

- `bg-red-500` → `background-color: var(--color-red-500)` — no palette in JS
- `p-13` → `padding: calc(var(--spacing) * 13)` — the entire numeric spacing scale needs
  **zero table entries** (v4's scale is multiplicative, not a lookup)
- `bg-red-500/50` → `color-mix(in oklab, var(--color-red-500) 50%, transparent)` — opacity
  modifiers need no color math in JS
- `prose` → a static CSS chunk emitted when the token appears — no typography plugin

What remains in JS: a candidate parser (small, well-specified grammar), a variant engine
(~40 selector/media transformers), and a utility dispatch table where most entries are one line.

**Size target: ≤ 40 KB min engine + ~20 KB static CSS** (theme + preflight + prose), vs ~200 KB
for the UnoCSS stack it would replace in colight, and ~150 KB+ for `@tailwindcss/browser`.
**Perf target: sub-millisecond flush** for a 500-token document (Map dispatch, no rule-regex
cascade), enabling a **fully synchronous** engine — CSS exists before `tw()` returns, no
microtask flush, no one-frame-unstyled caveat, no `settled()` promise.

### Why publish

- LLMs emit Tailwind classes by default. A tiny, correct, CSP-safe runtime engine makes
  LLM-generated HTML/JSX styleable anywhere with no build step — huge and growing audience.
- twind is unmaintained and v3-era; `@tailwindcss/browser` is official but heavy (full
  compiler) and explicitly "not for production"; UnoCSS runtime scans the DOM with a
  MutationObserver. There is a real gap: **small + sync + v4 + production-intended**.
- The conformance harness is itself part of the gift: a published pass-rate against the real
  Tailwind compiler is the credibility story ("X% of the generated v4 utility space,
  byte-identical").

### Colight motivation (deferred)

Colight's `tw()` currently drives `@unocss/core` (see `packages/colight/src/js/utils.ts` on
`main` — the ~40-line adapter, ordering rationale, and dev-mode unmatched-token warning all
carry over conceptually). Migration happens **only if/when the spike proves its point**; until
then this package is standalone and colight is untouched. Keep the adapter-compatible surface in
mind: `ensure(classes)`, idempotent tokens set, deterministic ordering, unmatched-token
reporting.

## Product shape

```
twilight/
  core     — pure: tokens → CSS string. No DOM. Runs in Node (SSR, tests, oracle diffing).
  dom      — injection adapter: style-element management, batching, cascade placement.
  tw       — the ergonomic helper: join class names, ensure CSS, return the string. Sync.
```

Published as **`@colight/twilight`** (the `@colight` npm org already carries `@colight/core`
and friends). Sketch of the public API:

```ts
import { createEngine } from "@colight/twilight"; // dom adapter
const engine = createEngine({
  /* target?, theme?, prose? */
});
engine.ensure("flex px-4 hover:bg-red-500/50"); // synchronous; CSS in document on return
engine.report; // unmatched tokens (dev tooling hook)

import { compile } from "@colight/twilight/core"; // pure core
compile(["flex", "px-4"]); // → { css, matched, unmatched }  — SSR / static extraction for free

import { tw } from "@colight/twilight"; // convenience singleton, twind-style
tw("flex px-4");
```

Design rules:

- **Sync all the way down.** No async imports, no generator promise. The table is local data.
- **Pure core / DOM shell.** The core never touches `document`; the harness and SSR both call
  the same function the browser does.
- **CSP-safe.** No eval, no CDN fetches, style injection via `<style>` text or
  `CSSStyleSheet` — must work in VS Code webviews / strict-CSP hosts.
- **Framework-agnostic.** React nowhere in the runtime.

## Architecture

### 1. Candidate parser

Grammar (mirrors v4's candidate parsing):

```
candidate := (variant ':')* important? negative? root ('-' value)? ('/' modifier)?
value     := ident | '[' arbitrary ']' | '(' custom-property ')'
variant   := named | '[' arbitrary-selector ']' | 'group-'x | 'peer-'x | 'data-'x | 'aria-'x
```

Plus arbitrary properties (`[color:red]`) and important (`!` — v4 puts it trailing:
`bg-red-500!`; accept both, emit v4). ~150 lines, exhaustively unit-tested, fuzzed against the
oracle's accept/reject behavior.

### 2. Utility table

A dispatch Map keyed on the root segment. Three entry kinds:

- **Static** (`flex`, `items-center`, `sr-only`, …): string → declarations. The biggest
  category by count, trivially compressible.
- **Functional-themed** (`bg-*`, `text-*`, `p-*`, `w-*`, `rounded-*`, …): property template ×
  theme namespace, emitting `var(--namespace-value)` / `calc(var(--spacing) * N)` /
  `color-mix(...)`. One line each in the table.
- **Composed** (shadows, rings, transforms, filters, gradients, `divide-*`, `space-*`): the
  custom-property composition machinery — the genuinely fiddly ~15%. Hand-written, mirroring
  v4's `@property` defaults (the preflight `*, ::before, ::after` custom-property block ships
  in the static layer).

### 3. Variant engine

Selector transformers (`hover:` → `&:hover`, `group-hover:` → `:is(:where(.group):hover *)&`
per v4's exact selectors, pseudo-elements, `dark:`, `data-*`/`aria-*`, arbitrary variants) and
media/supports wrappers (breakpoints, `motion-safe`, `print`, container queries if the ratchet
reaches them). **Caveat:** media queries cannot contain `var()`, so breakpoint values are the
one theme slice that must exist in JS. Default v4 breakpoints embedded (5 values); optionally
re-read from `--breakpoint-*` on the live document at engine init for custom themes.

### 4. Static CSS assets — generated, not hand-written

At **build time**, from the pinned `tailwindcss` package itself:

- `theme.css` — the default `@theme` flattened to `:root { --… }`
- `preflight.css` — v4's preflight verbatim
- `prose.css` — compiled from `@tailwindcss/typography` (emitted lazily on first `prose` token)

Regenerated by a script (`pnpm gen:assets`) whenever the Tailwind dev-dependency is bumped, so
these can never drift by hand. MIT with attribution in a NOTICE file. The engine code itself is
written against the documented grammar and oracle behavior — no copying of Tailwind source.

### 5. Ordering

Start with the proven approach from colight's UnoCSS adapter: each flush regenerates the full
token set with a deterministic sort (v4's utility ordering: property-based rank, variants after
bases, media queries last). Regeneration is cheap once generation is sub-millisecond.
Append-only insertion under `@layer` sublayers is the perf endgame — a ratchet-driven
optimization later, **not** a day-one requirement.

## Correctness: the oracle harness (built BEFORE the engine)

The reference implementation is a JS library: `import { compile } from "tailwindcss"` in Node
gives `build(candidates)`. That is the oracle. Never guess at semantics — ask.

### Differential runner

For each candidate token: oracle CSS vs twilight CSS → parse both (lightningcss) → normalize
(declaration order, whitespace, selector canonicalization, calc formatting) → structural diff.
Invalid tokens must be rejected by **both** sides. Every mismatch is a test failure with a
readable side-by-side diff.

### Corpus tiers

1. **In-repo corpus** (`conformance/corpus/colight.txt`) — every token colight actually uses:
   grep `tw(` call sites in `packages/colight/src/js` + docs, plus a runtime dump of the
   engine's token set from a docs-site crawl. **Gate: 100% match. This is the shipping bar for
   the colight migration decision.** It doubles as the v3→v4 semantic-change audit (border
   default color, ring width, shadow scale renames): every intentional v4 difference from
   current behavior shows up as an explicit diff here on day one.
2. **Generated corpus** — enumerate the grammar: utility roots × theme keys × modifiers ×
   variants, plus property-based random candidates and random arbitrary values. Thousands of
   cases; sampled per-CI-run, full sweep on demand/nightly.
3. **Negative corpus** — fuzzed junk and near-miss tokens (`text-red-1000`, `hover:`,
   `p-[`) rejected identically to the oracle.

### Ratchets (checked in, CI-enforced, monotonic)

- `conformance/ratchet.json` — generated-corpus pass rate. CI fails on decrease; raising it is
  how progress is measured.
- `size-budget.json` — gzipped bytes for engine and for engine+assets. Only goes down.
- `bench/thresholds.json` — cold 500-token compile, warm single-token incremental, first-paint
  injection. Regression threshold in CI, absolute numbers tracked over time.

This makes "ratchet performance and size while holding correctness" mechanical. It also solves
drift: Tailwind is a pinned dev-dependency, and bumping it converts upstream semantic changes
into visible conformance failures instead of silent divergence.

## Milestones

**M0 — Scaffold + null hypothesis.** Package skeleton, workspace wiring, vitest config. Then
the measurement that must precede engine code: drive `tailwindcss@4`'s `compile()`/`build()`
directly in a browser bundle (the way colight drives `@unocss/core`) and record gzipped size +
cold/warm flush latency. Decision gate: if it lands under ~100 KB gz and flushes fast, the
spike may end there. Expectation: too heavy (full compiler) — and the adapter written here
**is** the oracle harness, so nothing is wasted either way. Record the numbers in this file.

> **M0 results (2026-08-03, tailwindcss 4.3.3, node 24, `bench/null-hypothesis/`):**
> browser esm bundle of `compile()` + default theme.css: **298.7 KB minified, 77.1 KB
> min+gzip**. Latency: `compile()` init ~10 ms (async API), cold `build()` of 500 tokens
> ~9 ms, steady-state new-token build ~0.36 ms, already-seen tokens ~0 ms (candidate cache).
> Verdict: _perf_ of the real compiler is a non-issue; it clears the ~100 KB gz gate but at
> 2× twilight's whole-stack gz budget and ~7× its parse weight, and `compile()` is
> irreducibly async (one-frame-unstyled at startup). The spike continues on the size + sync
>
> - production-intended axes; the harness (M1) is no-regret either way, and the real-compiler
>   bundle is a viable fallback for colight if M2 stalls.
>
> **M0 discovery — resolved-value fallbacks:** for color opacity modifiers the oracle emits a
> `color-mix(in srgb, <resolved color> …)` fallback (concrete oklch value, not `var()`) plus
> an `@supports (color: color-mix(in lab, red, red))`-guarded `var()` version. So the engine
> does need resolved theme values for fallback emission — obtained by parsing `--name: value`
> pairs out of the `theme.css` asset it already ships, at init, not by embedding a second
> copy of the palette in JS.

**M1 — Harness first.** Differential runner, CSS normalization, corpus extraction script for
tier 1, generator for tier 2, ratchet + bench + size-budget CI scripts. All runnable via
`pnpm -F twilight conformance | bench | size`.

**M2 — Engine core.** Parser → variant engine → static utilities → spacing + color families →
asset generation script. Goal: **tier-1 (colight) corpus at 100%**, dev-mode unmatched
reporting wired.

**M3 — The long tail, ratchet-driven.** Composed utilities (shadows/rings/transforms/filters/
gradients), remaining variants, arbitrary everything. Raise the tier-2 ratchet each PR. Land
append-only injection only if the bench says it matters.

**M4 — Publish prep.** Publish as `@colight/twilight` (bare `twilight` and `tw4` are taken on
npm; the scoped name also keeps the colight org visible in the credit). README with the
conformance pass-rate and size badge as the headline, examples: vanilla `<script>`, React, and an "style LLM output with no build step"
demo. MIT + NOTICE. Decide repo home (extract vs publish from monorepo) at the end — develop in
the monorepo for now.

## Repo wiring (fresh-session checklist)

- Worktree: `~/IdeaProjects/colights/colight.twilight`, branch `twilight`.
- Add `packages/twilight` to `pnpm-workspace.yaml` (note: the root `vitest.config.mjs` only
  includes `packages/colight/tests/**` — give twilight its own vitest config or extend the
  root include).
- Dev-deps only: `tailwindcss@4`, `@tailwindcss/typography`, `lightningcss` (normalizer),
  vitest. **Runtime dependencies: zero.**
- Layout: `src/` (core, dom, tw), `assets/` (generated CSS + gen script), `conformance/`
  (runner, corpora, ratchet.json), `bench/`, `tests/`.
- Colight itself stays untouched on this branch until the M2 gate is met and we decide to
  migrate.

## Open questions

- **Theme customization surface** — v1 ships the default theme; custom themes are "bring your
  own `@theme` CSS + breakpoint values at init". How much config beyond that? (Lean: none.)
- **`prose` scope** — full typography plugin fidelity vs the subset colight renders. Oracle
  for prose is `@tailwindcss/typography` output; ratchet decides depth.
- **Dark mode strategy** — v4 default is `prefers-color-scheme`; colight may want
  class/attribute strategy. Support both via one init option?
- **How much of v4's exotica** (container queries, `@starting-style`, 3D transforms) before
  first publish — ratchet decides; publish honestly with the pass-rate number.
