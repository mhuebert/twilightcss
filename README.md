# twilightcss

**A minimal, synchronous Tailwind v4 runtime engine.** Call
`tw("flex px-4 hover:bg-red-500/50")` in the browser, get correct Tailwind v4
CSS in the document before the call returns. No build step, no config, no
dependencies. **16 KB gz** engine (24 KB with Tailwind's theme + preflight).

Every release is differentially tested against the real Tailwind compiler, and currently matches it on **20,000 / 20,000** generated utility candidates
after normalization, including identical _rejection_ of invalid classes.

```js
import { tw } from "twilightcss";

el.className = tw("flex items-center gap-2 px-4 rounded-md bg-white shadow-md");
// the CSS for those classes exists in <head> before this line runs
```

## Why this exists

The existing ways to run Tailwind at runtime:

|                            | min       | gz        | semantics                | sync           | status                                    |
| -------------------------- | --------- | --------- | ------------------------ | -------------- | ----------------------------------------- |
| twind v1                   | 46 KB     | 17 KB     | v3-era, approximate      | mostly         | unmaintained since ~2022                  |
| UnoCSS runtime             | 195 KB    | 52 KB     | v3-flavored dialect      | async          | active, but not Tailwind                  |
| tailwindcss v4 `compile()` | 299 KB    | 77 KB     | exact (it _is_ Tailwind) | async init     | official; “not for production” in-browser |
| **twilightcss**            | **51 KB** | **16 KB** | **v4, compiler-tested**  | **fully sync** | this package                              |

(All bundles measured the same way: esbuild, browser ESM, minified, gzip −9.
The twind/UnoCSS figures include their embedded themes; twilightcss ships its
theme as ~8 KB gz of static CSS on top of the 16 KB engine.)

A small engine became practical with Tailwind v4, which moved the theme out
of JavaScript into CSS custom properties. Where twind and UnoCSS embed every
color hex and spacing value as JS data, twilightcss ships Tailwind's `@theme`
as static CSS and emits only references:

- `bg-red-500` → `background-color: var(--color-red-500)`
- `p-13` → `padding: calc(var(--spacing) * 13)` (the spacing scale is a
  multiplication, not a lookup table)
- `bg-red-500/50` → `color-mix(in oklab, var(--color-red-500) 50%, transparent)`
  (no color math in JS)

What remains in JS is a candidate parser, a variant engine, and a utility
table, and most of that is the compressed Tailwind vocabulary itself.

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
joined class string synchronously.

### Styling LLM output

LLMs emit Tailwind classes by default. Twilight makes that HTML styleable
anywhere (chat UIs, sandboxes, CSP-strict webviews) without a build:

```js
import { createEngine } from "twilightcss";

const engine = createEngine();
function renderLLMHtml(html, container) {
  container.innerHTML = html; // sanitize untrusted HTML first
  for (const el of container.querySelectorAll("[class]")) {
    engine.ensure(el.getAttribute("class"));
  }
}
```

No CDN fetch or `eval`, style injection via `<style>` text only — it works
under strict Content-Security-Policy (VS Code webviews, Electron, sandboxed
iframes).

### Typography

`prose` ships as a separate asset, compiled from the real
`@tailwindcss/typography`. Pass it to the engine and it is injected once,
when the first `prose` token appears; if you never use it, you never load it:

```js
import { createEngine } from "twilightcss";
import { proseCss } from "twilightcss/assets/prose.mjs";

const engine = createEngine({ proseCss });
engine.ensure("prose"); // markdown containers get typography styles
```

Bare `prose` only for now — the `prose-sm` / `prose-invert` modifiers aren't
included yet.

### Custom themes

Utilities resolve against CSS variables, so extending the theme is how you
define new utilities. There is no plugin API or JS config object; the config
format is CSS:

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

One variable enables its whole family: `--color-brand-500` makes
`bg-/text-/border-/ring-/fill-…-brand-500` work with every variant and
opacity modifier, and `--breakpoint-widescreen` adds a `widescreen:` variant.
For component classes, use ordinary JavaScript constants:

```js
const focusRing =
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500";
```

### Server-side / static extraction

The core has no DOM dependency and runs anywhere:

```js
import { compile, compileOne } from "twilightcss/core";

const { css, unmatched } = compile(["flex", "px-4", "hover:bg-red-500/50"]);
// css: the stylesheet text; unmatched: tokens twilight (and Tailwind) reject
```

Pair with `assets/theme.mjs` and `assets/preflight.mjs` (raw CSS strings) to
emit complete documents.

## Correctness

The test suite drives the real Tailwind compiler (`tailwindcss`, pinned) as
an oracle and diffs its output against twilight's for each candidate class,
after CSS normalization with lightningcss:

- **Generated corpus**: candidates enumerated from the compiler's own class
  list × variants × modifiers × arbitrary values. Currently
  20,000 / 20,000 matching, enforced in CI as a ratchet that can only rise.
- **Negative corpus**: invalid classes must be rejected identically —
  twilight never invents CSS that Tailwind wouldn't produce.
- **Versioning**: the Tailwind version twilight matches is pinned in its
  devDependencies. Bumping it turns upstream changes into visible test
  failures instead of silent drift. Current oracle: tailwindcss 4.3.3.

If the compiler and twilight ever disagree, that's a bug in twilight.

## Not included (v0.1)

- **Rule ordering.** Rules are injected append-only, in first-seen order.
  When two classes of equal specificity target the same property on one
  element, injection order decides, not Tailwind's property order.
- **`@utility` / `@custom-variant` blocks** aren't parsed yet. Arbitrary
  values (`[mask-image:…]`, `bg-[#123]`) and arbitrary variants
  (`[&>li]:flex`) are the escape hatch.
- **Legacy-browser fallbacks.** The compiler's polyfill output (e.g.
  `color-mix` in `srgb` for pre-2023 engines) is not emitted; twilight
  targets current browsers and matches the compiler's un-polyfilled output.

## License

MIT. The static theme, preflight and typography assets are generated from
[Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) and
[@tailwindcss/typography](https://github.com/tailwindlabs/tailwindcss-typography)
(MIT, © Tailwind Labs); see NOTICE. Not affiliated with or endorsed by
Tailwind Labs.
