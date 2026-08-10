# twilightcss

**A small, fast Tailwind v4 runtime for dynamic UIs.** Call
`tw("flex px-4 hover:bg-red-500/50")` in the browser, get correct Tailwind v4
CSS in the document before the call returns. No built step, config, or dependencies.
**27 KB gz** all-in. 

(if you're familiar with [twind](https://github.com/tw-in-js/twind), this is the modern equivalent.)

Every release is differentially tested against the real Tailwind compiler, and currently matches it on **20,000 / 20,000** generated utility candidates after normalization, including identical _rejection_ of invalid classes.

```js
import { tw } from "twilightcss";

el.className = tw("flex items-center gap-2 px-4 rounded-md bg-white shadow-md");
// the CSS for those classes exists in <head> before this line runs
```

When would you want this?

1. You (or an LLM) want to **compose and render HTML at runtime**: chat UIs, playgrounds, dynamic artifacts, user-generated or CMS content.
2. **No build step is available**: plain script tags, scrict-CSP hosts (VS Code webviews, Electron, sandboxed iframes).
3. **Self-styling components**: libraries and embeddable widgets that can't ask the host page to run a tailwind build.

## One script tag

For pages you don't build — generated HTML, playgrounds, single-file
artifacts — include the drop-in build and nothing else:

```html
<script src="https://cdn.jsdelivr.net/npm/twilightcss@0.2"></script>
```

Zero configuration: it injects Tailwind's theme and preflight, styles
everything already on the page, and keeps watching — content added later,
including markup streamed in while the page is still parsing, is styled
before it paints. `tw` and `observe` are available on `window.twilightcss`
if you want them, and including the script twice is a no-op.

This is the same role as Tailwind's own browser build (or, a generation
back, the `cdn.tailwindcss.com` script-tag habit), with a different engine
underneath:

|                                    | `@tailwindcss/browser`                    | `twilightcss` drop-in                    |
| ---------------------------------- | ----------------------------------------- | ---------------------------------------- |
| size (gz)                          | 74 KB                                     | 27 KB                                    |
| CSS injection                      | async, full compiler                      | synchronous                              |
| mutation cost, 20k-element page    | ~11.5 ms/frame (rescans classed elements) | 0–1.4 ms/frame (proportional to change)  |
| production stance                  | “not for production”                      | production target                        |

Both style new content before its first paint; the differences are size,
steady-state cost on a mutating page, and intent. Methodology and full
numbers: [`bench/browser/`](bench/browser/README.md).

Customization uses the same channel as Tailwind's browser builds — a
`<style type="text/tailwindcss">` tag, anywhere in the page (before or
after the script; it can even stream in):

```html
<style type="text/tailwindcss">
  @theme {
    --color-brand-500: oklch(0.7 0.15 200);
    --breakpoint-widescreen: 100rem;
  }
  .btn {
    @apply px-3 py-1.5 rounded-md bg-brand-500 text-white hover:bg-brand-500/80;
  }
</style>
```

`@theme` variables validate their whole utility family (`bg-brand-500`,
`widescreen:flex`, …), and `@apply` expands exactly as the real compiler
expands it: utilities in canonical order, variants as CSS-nesting rules.
`@utility` / `@custom-variant` blocks aren't parsed yet — see
[Not included](#not-included-v02).

## As a module

```sh
npm install twilightcss
```

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

### Styling markup you didn't write

For HTML that arrives at runtime (chat UIs, artifacts, CMS content) point
the engine at a container and everything in it gets styled, including what
streams in later:

```js
import { observe } from "twilightcss";

const stop = observe(container); // sanitize untrusted HTML first
```

`observe` styles the existing tree before it returns, then watches for added
elements and class changes. Injection is synchronous and mutation callbacks
run before the browser paints, so new content is never shown unstyled. Call
the returned function to stop watching. It shares the default engine with
`tw()`, so the two mix freely.

This is the machinery behind the [drop-in build](#one-script-tag) — the
head-to-head numbers against `@tailwindcss/browser` there apply here too.

No CDN fetch or `eval`, style injection via `<style>` text only — it works
under strict Content-Security-Policy (VS Code webviews, Electron, sandboxed
iframes).

### Configuration

`tw` and `observe` share one default engine, created on first use. To give
it options, call `configure` once at startup, before the first `tw()` or
`observe()` (it throws if you're too late — an engine's options are fixed
at creation). This is a module-build affordance: the drop-in script
initializes the default engine the moment it loads.

```js
import { configure } from "twilightcss";

configure({ ...options });
```

`createEngine(options)` exists for when you genuinely need a *second*
engine — another document (an iframe, a webview) or deliberate isolation.
It returns the same `tw`/`observe` pair bound to its own stylesheet.

### Typography

`prose` ships as a separate asset, compiled from the real
`@tailwindcss/typography`. Configure it in and it is injected once, when
the first `prose` token appears; if you never use it, you never load it:

```js
import { configure, tw } from "twilightcss";
import { proseCss } from "twilightcss/assets/prose.mjs";

configure({ proseCss });
tw("prose"); // markdown containers get typography styles
```

Bare `prose` only for now — the `prose-sm` / `prose-invert` modifiers aren't
included yet.

### Custom themes

Utilities resolve against CSS variables, so extending the theme is how you
define new utilities. There is no plugin API or JS config object; the config
format is CSS:

```js
import { configure, tw } from "twilightcss";
import { themeCss } from "twilightcss/assets/theme.mjs";

configure({
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

tw("bg-brand-500/50 hover:border-brand-500 font-display text-huge widescreen:flex");
```

One variable enables its whole family: `--color-brand-500` makes
`bg-/text-/border-/ring-/fill-…-brand-500` work with every variant and
opacity modifier, and `--breakpoint-widescreen` adds a `widescreen:` variant.
`<style type="text/tailwindcss">` tags with `@theme` / `@apply` (see the
script-tag section) work in any mode — the engine processes them in
whatever document it's attached to. For component classes in JS, ordinary
constants compose:

```js
const focusRing =
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500";
```

### Server-side / static extraction

The core has no DOM dependency and runs anywhere:

```js
import { compile, compileOne } from "twilightcss/core";

const { css, unmatched } = compile(["flex", "px-4", "hover:bg-red-500/50"]);
// css: the stylesheet text, in Tailwind's canonical rule order;
// unmatched: tokens twilight (and Tailwind) reject
```

Pair with `assets/theme.mjs` and `assets/preflight.mjs` (raw CSS strings) to
emit complete documents.

## Compared to the alternatives

The existing ways to run Tailwind at runtime:

|                            | min       | gz        | semantics                | sync           | status                                    |
| -------------------------- | --------- | --------- | ------------------------ | -------------- | ----------------------------------------- |
| twind v1                   | 46 KB     | 17 KB     | v3-era, approximate      | mostly         | unmaintained since ~2022                  |
| UnoCSS runtime             | 195 KB    | 52 KB     | v3-flavored dialect      | async          | active, but not Tailwind                  |
| tailwindcss v4 `compile()` | 299 KB    | 77 KB     | exact (it _is_ Tailwind) | async init     | official; “not for production” in-browser |
| **twilightcss**            | **89 KB** | **27 KB** | **v4, compiler-tested**  | **fully sync** | this package                              |

(All bundles measured the same way: esbuild, browser ESM, minified, gzip −9,
themes included — twilightcss's figure is the whole shippable stack. Its
theme is static CSS, so a consumer that brings its own theme carries just
the 63 KB min / 20 KB gz engine.)

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

## Correctness

The test suite drives the real Tailwind compiler (`tailwindcss`, pinned) as
an oracle and diffs its output against twilight's for each candidate class,
after CSS normalization with lightningcss:

- **Generated corpus**: candidates enumerated from the compiler's own class
  list × variants × modifiers × arbitrary values. Currently
  20,000 / 20,000 matching, enforced in CI as a ratchet that can only rise.
- **Negative corpus**: invalid classes must be rejected identically —
  twilight never invents CSS that Tailwind wouldn't produce.
- **Rule order**: rules are kept in the compiler's canonical order (checked
  against its `getClassOrder`), so when two equal-specificity classes target
  the same property on one element — `p-4 px-2` — the cascade resolves them
  the way a Tailwind build would. Currently 131,018 / 131,018 ordered pairs
  agreeing, same ratchet regime.
- **Versioning**: the Tailwind version twilight matches is pinned in its
  devDependencies. Bumping it turns upstream changes into visible test
  failures instead of silent drift. Current oracle: tailwindcss 4.3.3.

If the compiler and twilight ever disagree, that's a bug in twilight.

## Not included (v0.2)

- **`@utility` / `@custom-variant` blocks** aren't parsed yet (`@theme` and
  `@apply` in `<style type="text/tailwindcss">` tags are). Arbitrary values
  (`[mask-image:…]`, `bg-[#123]`), arbitrary variants (`[&>li]:flex`) and
  `@apply` are the escape hatches.
- **Legacy-browser fallbacks.** The compiler's polyfill output (e.g.
  `color-mix` in `srgb` for pre-2023 engines) is not emitted; twilight
  targets current browsers and matches the compiler's un-polyfilled output.

## License

MIT. The static theme, preflight and typography assets are generated from
[Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) and
[@tailwindcss/typography](https://github.com/tailwindlabs/tailwindcss-typography)
(MIT, © Tailwind Labs); see NOTICE. Not affiliated with or endorsed by
Tailwind Labs.
