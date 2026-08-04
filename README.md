# twilightcss

**A minimal, synchronous Tailwind v4 runtime engine.** Call
`tw("flex px-4 hover:bg-red-500/50")` in the browser, get correct Tailwind v4
CSS in the document before the call returns. No build step, no config, no
dependencies. **16 KB gz** engine (24 KB with Tailwind's theme + preflight),
and — the part that makes it different — **provably correct**: every release
is differentially tested against the real Tailwind compiler, and currently
matches it on **20,000 / 20,000** generated utility candidates, byte-for-byte
after normalization, including identical _rejection_ of invalid classes.

```js
import { tw } from "twilightcss";

el.className = tw("flex items-center gap-2 px-4 rounded-md bg-white shadow-md");
// the CSS for those classes exists in <head> before this line runs
```

## Why this exists

Runtime Tailwind had two options, both compromised:

|                            | min       | gz        | semantics                | sync           | status                                    |
| -------------------------- | --------- | --------- | ------------------------ | -------------- | ----------------------------------------- |
| twind v1                   | 46 KB     | 17 KB     | v3-era, approximate      | mostly         | unmaintained since ~2022                  |
| UnoCSS runtime             | 195 KB    | 52 KB     | v3-flavored dialect      | async          | active, but not-Tailwind                  |
| tailwindcss v4 `compile()` | 299 KB    | 77 KB     | exact (it _is_ Tailwind) | async init     | official; “not for production” in-browser |
| **twilight**               | **51 KB** | **16 KB** | **v4, oracle-verified**  | **fully sync** | this package                              |

(All bundles measured identically: esbuild, browser ESM, minified, gzip −9.
The twind/UnoCSS figures include their embedded themes; twilight's theme
ships as ~8 KB gz of static CSS on top of the 16 KB engine.)

Tailwind v4 made a small engine newly possible: **the theme moved out of
JavaScript into CSS custom properties.** Where twind and UnoCSS embed every
color hex and spacing value as JS data, twilight ships Tailwind's `@theme`
as static CSS and emits only references:

- `bg-red-500` → `background-color: var(--color-red-500)`
- `p-13` → `padding: calc(var(--spacing) * 13)` — the whole spacing scale is
  one multiplication, zero table entries
- `bg-red-500/50` → `color-mix(in oklab, var(--color-red-500) 50%, transparent)`
  — no color math in JS

What remains in JS is a candidate parser, a variant engine, and a utility
table — and 72% of _that_ is the compressed Tailwind vocabulary itself.

## Install

```sh
npm install twilightcss
```

## Use

### Vanilla

```html
<script type="module">
  import { tw } from "twilightcss";
  document.body.innerHTML = `
    <button class="${tw("px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700")}">
      Styled at runtime
    </button>`;
</script>
```

### React

```jsx
import { tw } from "twilightcss";

function Badge({ children, tone = "gray" }) {
  return (
    <span
      className={tw(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        tone === "red" && "bg-red-100 text-red-800",
        tone === "gray" && "bg-gray-100 text-gray-800",
      )}
    >
      {children}
    </span>
  );
}
```

`tw()` joins its string arguments (falsy arguments are dropped, so the
`cond && "classes"` idiom works), ensures the CSS exists, and returns the
joined class string — synchronously. There is no `settled()`, no flush, no
one-frame-unstyled caveat. That is the entire API for most uses.

### Styling LLM output — the no-build-step case

LLMs emit Tailwind classes by default. Twilight makes that HTML styleable
anywhere — chat UIs, sandboxes, CSP-strict webviews — without a build:

```js
import { createEngine } from "twilightcss";

const engine = createEngine();
function renderLLMHtml(html, container) {
  container.innerHTML = html; // sanitize first, as ever
  for (const el of container.querySelectorAll("[class]")) {
    engine.ensure(el.getAttribute("class"));
  }
}
```

No CDN fetch, no `eval`, style injection via `<style>` text only — it works
under strict Content-Security-Policy (VS Code webviews, Electron, sandboxed
iframes).

### Custom themes: the config format is CSS

Because utilities resolve against CSS variables, **extending the theme is
defining utilities.** No plugin API, no JS config object:

```js
import { createEngine } from "twilightcss";
import { themeCss } from "twilightcss/assets/theme.mjs";

const engine = createEngine({
  themeCss:
    themeCss +
    `
    :root {
      --color-brand-500: oklch(0.7 0.15 200);
      --font-display: Poppins, sans-serif;
      --text-huge: 4rem; --text-huge--line-height: 1.05;
      --breakpoint-widescreen: 100rem;
    }`,
});

engine.ensure(
  "bg-brand-500/50 hover:border-brand-500 font-display text-huge widescreen:flex",
);
```

One variable lights up its whole family: `--color-brand-500` enables
`bg-/text-/border-/ring-/fill-…-brand-500` with every variant and opacity
modifier; `--breakpoint-widescreen` enables the `widescreen:` variant. For
component classes, compose in JavaScript — a constant holding a `tw()` string
is the component abstraction, and it needs no framework:

```js
const focusRing =
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500";
```

### Server-side / static extraction

The core is pure — no DOM — and runs anywhere:

```js
import { compile, compileOne } from "twilightcss/core";

const { css, unmatched } = compile(["flex", "px-4", "hover:bg-red-500/50"]);
// css: the stylesheet text; unmatched: tokens twilight (and Tailwind) reject
```

Pair with `assets/theme.mjs` and `assets/preflight.mjs` (raw CSS strings) to
emit complete documents.

## Correctness, verifiably

Most utility libraries assert compatibility; twilight measures it. The test
suite drives the **real Tailwind compiler** (`tailwindcss`, pinned) as an
oracle and diffs its output against twilight's per candidate class, after
CSS normalization (lightningcss):

- **Generated corpus**: candidates enumerated from the compiler's own class
  list × variants × modifiers × arbitrary values. Current status:
  **20,000 / 20,000 matching**, enforced as a CI ratchet that can only rise.
- **Negative corpus**: invalid classes must be _rejected identically_ —
  twilight never invents CSS Tailwind wouldn't produce.
- **Version honesty**: the Tailwind version twilight matches is pinned in its
  devDependencies; bumping it turns upstream changes into visible test
  failures instead of silent drift. Current oracle: **tailwindcss 4.3.3**.

This also defines the compatibility contract precisely: if the real compiler
and twilight ever disagree, that is a bug here, not a matter of opinion.

## What's deliberately out (v0.1)

- **CSS output is per-class, unsorted across buckets** — rules are injected
  append-only in first-seen order. Same-specificity conflicts between
  _different_ classes on one element resolve by injection order, not
  Tailwind's property order. (The colight adapter shows a 3-bucket pattern —
  base / variants / media — that covers the practical cases.)
- **`@utility` / `@custom-variant` blocks** aren't parsed yet; arbitrary
  values (`[mask-image:…]`, `bg-[#123]`) and arbitrary variants
  (`[&>li]:flex`) are the escape hatch.
- **Typography (`prose`)** isn't bundled; generate it from
  `@tailwindcss/typography` with the real compiler and inject it as static
  CSS (colight does exactly this).
- The compiler's browser-polyfill fallbacks (e.g. `color-mix` in `srgb` for
  pre-2023 engines) are not emitted; twilight targets baseline-modern
  browsers, matching the compiler's un-polyfilled output.

## License

MIT. The static theme and preflight assets are generated from
[Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) (MIT, © Tailwind
Labs) — see NOTICE. Not affiliated with or endorsed by Tailwind Labs.
