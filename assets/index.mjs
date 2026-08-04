// Engine + static assets: the "engine+assets" size-budget target.
// (prose is opt-in and deliberately not part of this budget.)
export * from "../src/index.ts";
export { themeCss, inlineThemeVars } from "./theme.mjs";
export { preflightCss } from "./preflight.mjs";
