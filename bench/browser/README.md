# Browser benchmark: twilightcss vs the Play CDN build

Compares four pages on identical, deterministic DOM workloads in real Chrome:

- **none** — no engine at all; the cost of the workload itself.
- **static** — twilight's full generated stylesheet injected once, no
  observer. What a build-time Tailwind file would cost the browser.
- **play** — `@tailwindcss/browser` (the Play CDN build), pinned to the same
  tailwindcss version the conformance oracle uses. It observes the whole
  document and rebuilds through the real compiler.
- **twilight** — `createEngine().observe(document.body)`.

Run with `pnpm build && pnpm bench:browser`. Uses the system Chrome via
playwright-core (headless); the Play script is fetched once from jsdelivr.
Workloads come from a fixed ~200-class vocabulary (`vocab.mjs`) and a seeded
PRNG, so every engine sees byte-identical DOM. Play's own
`performance.measure` marks are collected alongside our timings.

## Scenarios

- **cold** — 1,000 classed elements exist before the engine loads; time to
  the first fully styled paint.
- **stream** — 60 chunks of 15 elements appended one per frame (markup
  arriving from an LLM); per-chunk styling latency, and whether any chunk
  was ever painted unstyled. Every fifth chunk introduces a class the page
  has never seen.
- **churn** — steady state: 300 frames, each toggling 10 class attributes
  and appending 5 elements, all classes already seen. Isolates per-mutation
  engine overhead as the document grows.

## Results (2026-08-06, headless Chrome 150, Apple Silicon, localhost)

Bundle: play 282 KB min / 74 KB gz · twilight 59 KB min / 18 KB gz.

**cold** — both engines style the very first paint (0 unstyled frames).
Play is ready in ~29 ms (compiler init ~8 ms + first build ~16 ms),
twilight in ~40 ms (module import + theme parse + initial scan).

**stream** — median time from append to styled, at ~120 fps (8.3 ms frames):

|                          | play    | twilight |
| ------------------------ | ------- | -------- |
| chunk reuses seen classes | 8.3 ms | 8.2 ms   |
| chunk has a new class     | 13 ms  | 9 ms     |
| chunks painted unstyled   | 0      | 0        |

**churn** — average frame time over 300 frames of identical mutation load:

| document size | none    | static  | twilight | play     |
| ------------- | ------- | ------- | -------- | -------- |
| 1,000 els     | 8.35 ms | 8.35 ms | 8.35 ms  | 8.4 ms   |
| 5,000 els     | 8.35 ms | 8.35 ms | 8.36 ms  | 9.3 ms   |
| 20,000 els    | 8.35 ms | 23.7 ms | 23.7 ms  | 35.2 ms  |

Reading the churn table: the jump from `none` to `static` at 20k elements is
the browser recalculating styles on a large tree against the stylesheet
(preflight's universal selectors) — a cost any Tailwind page pays, built or
runtime. On top of that, twilight's observer adds nothing measurable
(0–1.4 ms/frame run-to-run); Play adds ~11.5 ms/frame, which its own marks
attribute to "Collect classes" — it rescans `document.querySelectorAll("[class]")`
on every mutation batch, so its per-mutation cost scales with document size
(1.0 → 3.2 → 11.5 ms/frame at 1k → 5k → 20k) where twilight's scales with
the size of the change.

Numbers are one machine on localhost; rerun locally before quoting them.
