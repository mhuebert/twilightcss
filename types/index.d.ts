/**
 * twilightcss — a minimal synchronous Tailwind v4 runtime engine.
 */
export {
  compile,
  compileOne,
  createTheme,
  parseThemeVars,
  defaultTheme,
  type CompiledRule,
  type CompileResult,
  type Theme,
} from "./core.js";

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
   * Style everything under `root` (default: the document body), now and as
   * it changes. Returns a function that stops watching. Elements already in
   * the tree are styled before this returns; later ones are styled as they
   * are added, so markup that arrives piece by piece is never shown
   * unstyled.
   */
  observe(root?: ParentNode & Node): () => void;
  /** Every token ever styled through tw()/observe() */
  readonly tokens: Set<string>;
  /** Tokens twilight could not compile (dev tooling hook) */
  readonly unmatched: Set<string>;
}

export declare function createEngine(options?: EngineOptions): Engine;

/**
 * Create the default engine with options (typography, a custom theme, …).
 * Call once, before the first tw()/observe(); configuring after the default
 * engine exists throws. Returns the engine. For a second, independent
 * engine use createEngine().
 */
export declare function configure(options?: EngineOptions): Engine;

/**
 * Join class names and guarantee their CSS exists — synchronously: the
 * stylesheet is updated before this returns. Uses the default engine.
 */
export declare function tw(...args: unknown[]): string;

/**
 * Style everything under `root` (default: the document body) with the
 * default engine — now and as the tree changes. Returns a function that
 * stops watching.
 */
export declare function observe(root?: ParentNode & Node): () => void;
