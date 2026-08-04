/**
 * twilightcss — a minimal synchronous Tailwind v4 runtime engine.
 */
export {
  compile,
  compileOne,
  createTheme,
  parseThemeVars,
  defaultTheme,
  type CompileResult,
  type Theme,
} from "./core.js";

export interface EngineOptions {
  /** document to inject into (default: globalThis.document) */
  target?: Document;
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
  /** Compile any new tokens in `classes` and inject their CSS. Synchronous. */
  ensure(classes: string): void;
  /** Every token ever passed to ensure() */
  readonly tokens: Set<string>;
  /** Tokens twilight could not compile (dev tooling hook) */
  readonly unmatched: Set<string>;
}

export declare function createEngine(options?: EngineOptions): Engine;

/**
 * Join class names and guarantee their CSS exists — synchronously: the
 * stylesheet is updated before this returns. Uses a per-page singleton
 * engine with the default theme.
 */
export declare function tw(...args: unknown[]): string;
