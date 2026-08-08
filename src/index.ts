// twilightcss — a minimal synchronous Tailwind v4 runtime engine.
export {
  compile,
  compileOne,
  createTheme,
  defaultTheme,
  type CompiledRule,
  type CompileResult,
  type Theme,
} from "./core/index.ts";
export { createEngine, type Engine, type EngineOptions } from "./dom.ts";

import { createEngine, type Engine, type EngineOptions } from "./dom.ts";

// The default engine: what the bare tw()/observe() exports delegate to.
// Created lazily on first use (never at import time — importing this module
// in Node must not touch `document`), or explicitly by configure(). One per
// module instance; if a page bundles twilightcss twice it gets two engines,
// so bundle it once — deduplicate at the packaging layer, not through a
// runtime global.
let engine: Engine | null = null;
const singleton = (): Engine => (engine ??= createEngine());

/**
 * Create the default engine with options (typography, a custom theme, …).
 * Call once, before the first tw()/observe() — the default engine is created
 * on first use, and an engine's options are fixed at creation, so
 * configuring after that throws rather than half-applying. Returns the
 * engine. For a second, independent engine use createEngine().
 */
export function configure(options?: EngineOptions): Engine {
  if (engine)
    throw new Error(
      "twilightcss: configure() must run before the first tw()/observe()",
    );
  return (engine = createEngine(options));
}

/**
 * Style everything under `root` (default: the document body) with the
 * default engine — now and as the tree changes. Returns a function that
 * stops watching.
 */
export const observe = (root?: ParentNode & Node): (() => void) =>
  singleton().observe(root);

/**
 * Join class names (falsy arguments are dropped, so `cond && "…"` works) and
 * guarantee their CSS exists — synchronously: the stylesheet is updated
 * before this returns. Uses the default engine.
 */
export const tw = (...args: unknown[]): string => singleton().tw(...args);
