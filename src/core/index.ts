// twilight core — pure: tokens → CSS. No DOM. This is the module the browser
// engine, SSR, and the conformance harness all share.
import { parseCandidate } from "./parse.ts";
import { lookupUtility, type PropDef } from "./utilities.ts";
import { resolveVariant } from "./variants.ts";
import { emit, escapeClassName, type Node, type StyleRule } from "./emit.ts";
import { createTheme, type Theme } from "./theme.ts";
import { themeCss, inlineThemeVars } from "../../assets/theme.mjs";

export type { Theme };
export { createTheme, parseThemeVars } from "./theme.ts";

const defaultTheme = createTheme(themeCss, inlineThemeVars);

export interface CompileResult {
  /** Concatenated CSS for all matched tokens, in input order. */
  css: string;
  /** token → its CSS chunk */
  matched: Map<string, string>;
  /** tokens twilight could not compile */
  unmatched: string[];
}

/** CSS for a single candidate, or null if twilight rejects it. */
export function compileOne(
  token: string,
  theme: Theme = defaultTheme,
): string | null {
  const cand = parseCandidate(token);
  if (cand === null) return null;

  const utility = lookupUtility(cand.base, {
    theme,
    negative: cand.negative,
    modifier: cand.modifier,
  });
  if (utility === null) return null;

  // class selector, then variant transforms right-to-left; at-rule wrappers
  // accumulate outward (leftmost variant = outermost wrapper).
  let selector = `.${escapeClassName(token)}`;
  const wrappers: string[] = [];
  for (let i = cand.variants.length - 1; i >= 0; i--) {
    const applied = resolveVariant(cand.variants[i]!, theme);
    if (applied === null) return null;
    for (const a of applied) {
      if (a.selector) selector = a.selector(selector);
      if (a.wrapper) wrappers.unshift(a.wrapper);
    }
  }
  if (utility.selectorWrap) selector = utility.selectorWrap(selector);

  let rule: Node = { selector, nodes: utility.nodes } satisfies StyleRule;
  for (let i = wrappers.length - 1; i >= 0; i--) {
    rule = { at: wrappers[i]!, nodes: [rule] };
  }

  let css = emit([rule], { important: cand.important });
  for (const p of utility.properties ?? []) css += emitProperty(p);
  return css;
}

function emitProperty(p: PropDef): string {
  let body = `  syntax: "${p.syntax}";\n  inherits: ${p.inherits};\n`;
  if (p.initial !== undefined) body += `  initial-value: ${p.initial};\n`;
  return `@property ${p.name} {\n${body}}\n`;
}

export function compile(
  tokens: Iterable<string>,
  theme: Theme = defaultTheme,
): CompileResult {
  const matched = new Map<string, string>();
  const unmatched: string[] = [];
  for (const token of tokens) {
    const css = compileOne(token, theme);
    if (css == null) unmatched.push(token);
    else matched.set(token, css);
  }
  return { css: [...matched.values()].join(""), matched, unmatched };
}
