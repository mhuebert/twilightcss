// DOM adapter: style-element management over the pure core. Fully
// synchronous — the CSS for a token exists in the document before ensure()
// returns. No microtask flush, no one-frame-unstyled caveat, no settled().
import {
  compileOne,
  createTheme,
  defaultTheme,
  type Theme,
} from "./core/index.ts";
import { themeCss as defaultThemeCss } from "../assets/theme.mjs";
import { preflightCss } from "../assets/preflight.mjs";

export interface EngineOptions {
  /** document to inject into (default: globalThis.document) */
  target?: Document;
  /** custom flattened theme CSS (`:root { --… }`); replaces the default */
  themeCss?: string;
  /** inject Tailwind's preflight reset (default true) */
  preflight?: boolean;
}

export interface Engine {
  /** Compile any new tokens in `classes` and inject their CSS. Synchronous. */
  ensure(classes: string): void;
  /** Every token ever passed to ensure() */
  readonly tokens: Set<string>;
  /** Tokens twilight could not compile (dev tooling hook) */
  readonly unmatched: Set<string>;
}

// Class names that legitimately carry no CSS of their own: group/peer are
// markers their group-*/peer-* variants select through.
const NON_UTILITY = /^(group|peer)(\/[\w-]+)?$/;

export function createEngine(options: EngineOptions = {}): Engine {
  const doc = options.target ?? document;
  const theme: Theme = options.themeCss
    ? createTheme(options.themeCss)
    : defaultTheme;

  const styleTag = (name: string): HTMLStyleElement => {
    const el = doc.createElement("style");
    el.setAttribute(name, "");
    // Prepended so document- and host-authored stylesheets (which load after
    // us) can still override a utility. Created in REVERSE cascade order —
    // each prepend lands above the last — so the document reads
    // preflight → theme → utilities and utilities win.
    doc.head.prepend(el);
    return el;
  };

  const utilitiesEl = styleTag("data-twilight");
  const themeEl = styleTag("data-twilight-theme");
  if (options.preflight !== false) {
    const preflightEl = styleTag("data-twilight-preflight");
    preflightEl.textContent = preflightCss;
  }
  themeEl.textContent = options.themeCss ?? defaultThemeCss;

  const tokens = new Set<string>();
  const unmatched = new Set<string>();
  // Injection is append-only in first-seen order; each token's chunk keeps
  // its own variants/media adjacent. (v4 property-rank ordering is a later,
  // conformance-verified pass — see PLAN §5.)
  const ensure = (classes: string): void => {
    let added = "";
    for (const token of classes.split(/\s+/)) {
      if (!token || tokens.has(token)) continue;
      tokens.add(token);
      const css = compileOne(token, theme);
      if (css === null) {
        if (!NON_UTILITY.test(token)) unmatched.add(token);
        continue;
      }
      added += css;
    }
    if (added) utilitiesEl.textContent += added;
  };

  return { ensure, tokens, unmatched };
}
