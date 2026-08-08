// DOM adapter: style-element management over the pure core. Fully
// synchronous — the CSS for a token exists in the document before add()
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
  document?: Document;
  /** custom flattened theme CSS (`:root { --… }`); replaces the default */
  themeCss?: string;
  /** inject Tailwind's preflight reset (default true) */
  preflight?: boolean;
  /**
   * typography CSS (import { proseCss } from "twilightcss/assets/prose.mjs"),
   * injected once, on the first `prose` token
   */
  proseCss?: string;
}

export interface Engine {
  /**
   * Join class names (falsy arguments are dropped, so `cond && "…"` works)
   * and inject their CSS — synchronously: the stylesheet is updated before
   * this returns. Returns the joined class string.
   */
  tw(...args: unknown[]): string;
  /**
   * Style everything under `root` (default: the document body), now and as it
   * changes. Returns a function that stops watching. Elements already in the
   * tree are styled before this returns; later ones are styled as they are
   * added, so markup that arrives piece by piece is never shown unstyled.
   */
  observe(root?: ParentNode & Node): () => void;
  /** Every token ever styled through tw()/observe() */
  readonly tokens: Set<string>;
  /** Tokens twilight could not compile (dev tooling hook) */
  readonly unmatched: Set<string>;
}

// Class names that legitimately carry no CSS of their own: group/peer are
// markers their group-*/peer-* variants select through.
const NON_UTILITY = /^(group|peer)(\/[\w-]+)?$/;

export function createEngine(options: EngineOptions = {}): Engine {
  const doc = options.document ?? document;
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
  // created up front so its cascade position (below theme, above utilities)
  // is fixed even though it fills in lazily
  const proseEl =
    options.proseCss !== undefined ? styleTag("data-twilight-prose") : null;
  const themeEl = styleTag("data-twilight-theme");
  if (options.preflight !== false) {
    const preflightEl = styleTag("data-twilight-preflight");
    preflightEl.textContent = preflightCss;
  }
  themeEl.textContent = options.themeCss ?? defaultThemeCss;

  const tokens = new Set<string>();
  const unmatched = new Set<string>();

  // Rules are held in Tailwind v4's canonical order rather than the order the
  // page happened to render them in, so `p-4` and `px-2` on one element
  // resolve the way the real compiler resolves them. Insertion is a binary
  // search into a sorted array (equal ranks keep first-seen order); the style
  // element is rewritten once per add() call that inserted anything, which is
  // the same O(total) work per call that appending to its text was.
  const rules: { rank: number; css: string }[] = [];

  const insert = (rank: number, css: string): void => {
    let lo = 0;
    let hi = rules.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rules[mid]!.rank <= rank) lo = mid + 1;
      else hi = mid;
    }
    rules.splice(lo, 0, { rank, css });
  };

  const add = (classes: string): void => {
    let added = false;
    for (const token of classes.split(/\s+/)) {
      if (!token || tokens.has(token)) continue;
      tokens.add(token);
      if (token === "prose" && proseEl) {
        proseEl.textContent = options.proseCss!;
        continue;
      }
      const rule = compileOne(token, theme);
      if (rule === null) {
        if (!NON_UTILITY.test(token)) unmatched.add(token);
        continue;
      }
      insert(rule.rank, rule.css);
      added = true;
    }
    if (added) {
      let css = "";
      for (const rule of rules) css += rule.css;
      utilitiesEl.textContent = css;
    }
  };

  const addTree = (node: ParentNode & Node): void => {
    const cls =
      node.nodeType === 1 ? (node as Element).getAttribute("class") : null;
    if (cls) add(cls);
    for (const el of node.querySelectorAll("[class]"))
      add(el.getAttribute("class")!);
  };

  const observe = (root?: ParentNode & Node): (() => void) => {
    // Content lives in the body, so that is the default. Callers running
    // before the body exists should pass a root of their own.
    const target = root ?? doc.body ?? doc.documentElement;
    addTree(target);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          const cls = (record.target as Element).getAttribute("class");
          if (cls) add(cls);
        } else {
          for (const node of record.addedNodes)
            if (node.nodeType === 1) addTree(node as Element);
        }
      }
    });
    observer.observe(target, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  };

  const tw = (...args: unknown[]): string => {
    let classes = "";
    for (const arg of args) {
      if (typeof arg !== "string" || !arg) continue;
      classes = classes ? classes + " " + arg : arg;
    }
    if (classes) add(classes);
    return classes;
  };

  return { tw, observe, tokens, unmatched };
}
