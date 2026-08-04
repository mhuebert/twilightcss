// twilightcss — a minimal synchronous Tailwind v4 runtime engine.
export {
  compile,
  compileOne,
  createTheme,
  defaultTheme,
  type CompileResult,
  type Theme,
} from "./core/index.ts";
export { createEngine, type Engine, type EngineOptions } from "./dom.ts";

import { createEngine, type Engine } from "./dom.ts";

// Convenience singleton, twind-style. One engine per window even if the
// module is bundled twice.
const ENGINE_KEY = "__twilight_engine__";
let engine: Engine | null = null;
function singleton(): Engine {
  if (engine) return engine;
  const g = globalThis as Record<string, unknown>;
  engine = (g[ENGINE_KEY] as Engine) ?? (g[ENGINE_KEY] = createEngine());
  return engine;
}

/**
 * Join class names and guarantee their CSS exists — synchronously: the
 * stylesheet is updated before this returns.
 */
export function tw(...args: unknown[]): string {
  let classes = "";
  for (const arg of args) {
    if (typeof arg !== "string" || !arg) continue;
    classes = classes ? classes + " " + arg : arg;
  }
  if (classes) singleton().ensure(classes);
  return classes;
}
