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

export const defaultTheme = createTheme(themeCss, inlineThemeVars);

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

  // class selector, then variant transforms LEFT-TO-RIGHT (v4 appends each
  // variant's selector part in written order); at-rule wrappers also
  // accumulate left-to-right, leftmost outermost.
  let selectors = [`.${escapeClassName(token)}`];
  const wrappers: string[] = [];
  const extraDecls: Node[] = [];
  const extraProps: PropDef[] = [];
  // Nested context (before:/after:): variants to the right of the
  // pseudo-element become nested levels inside its rule instead of composing
  // onto the selector — per variant, selector levels first, then media.
  let nesting = false;
  type Level =
    | { sel: string; decls?: Node[] }
    | { sels: string[] }
    | { at: string };
  const levels: Level[] = [];
  for (const v of cand.variants) {
    const applied = resolveVariant(v, theme);
    if (applied === null) return null;
    if (nesting) {
      const selLevels: Level[] = [];
      const atLevels: Level[] = [];
      for (const a of applied) {
        if (a.selector) {
          // v4 prints nested :not() targets with an explicit `*`
          const suffix = a.selector("&").replace(/^&:not\(:/, "&:not(*:");
          // a nested before:/after: carries its content decl at its own level
          selLevels.push(
            a.decls ? { sel: suffix, decls: a.decls } : { sel: suffix },
          );
        }
        if (a.selectors)
          selLevels.push({
            // nested fan-outs print the descendant part with an explicit `*`
            sels: a.selectors("&").map((s) => s.replace(/^& ::/, "& *::")),
          });
        if (a.wrapper) atLevels.push({ at: a.wrapper });
        if (a.decls && !a.selector) extraDecls.push(...a.decls);
        if (a.properties) extraProps.push(...a.properties);
      }
      levels.push(...selLevels, ...atLevels);
      continue;
    }
    for (const a of applied) {
      if (a.selector) selectors = selectors.map(a.selector);
      if (a.selectors) selectors = selectors.flatMap(a.selectors);
      if (a.wrapper) wrappers.push(a.wrapper);
      if (a.decls) extraDecls.push(...a.decls);
      if (a.properties) extraProps.push(...a.properties);
      if (a.nest) nesting = true;
    }
  }
  // In a nested context the utility's selector wrap (::placeholder,
  // :where(& > …)) becomes the innermost nested level instead of composing
  // onto the outer selector.
  if (utility.selectorWrap) {
    if (nesting) levels.push({ sel: utility.selectorWrap("&") });
    else selectors = selectors.map(utility.selectorWrap);
  }

  // build the innermost nodes, then wrap in nested levels (innermost last)
  let inner: Node[] = utility.nodes;
  for (let i = levels.length - 1; i >= 0; i--) {
    const level = levels[i]!;
    if ("at" in level) inner = [{ at: level.at, nodes: inner }];
    else if ("sel" in level)
      inner = [
        {
          selector: level.sel,
          nodes: level.decls ? [...level.decls, ...inner] : inner,
        },
      ];
    else inner = level.sels.map((sel) => ({ selector: sel, nodes: inner }));
  }
  const nodes = extraDecls.length ? [...extraDecls, ...inner] : inner;
  let rules: Node[];
  if (
    wrappers.length &&
    !nesting &&
    selectors.length === 1 &&
    nodes.some((n) => "at" in n)
  ) {
    // v4 flattens rule-nested at-rules when the rule sits inside a wrapper:
    // decl runs become sibling rules, at-rule children wrap their own copy.
    const selector = selectors[0]!;
    rules = [];
    let run: Node[] = [];
    const flush = () => {
      if (run.length) rules.push({ selector, nodes: run });
      run = [];
    };
    for (const n of nodes) {
      if ("at" in n) {
        flush();
        rules.push({ at: n.at, nodes: [{ selector, nodes: n.nodes }] });
      } else run.push(n);
    }
    flush();
  } else {
    rules = selectors.map(
      (selector) => ({ selector, nodes }) satisfies StyleRule,
    );
  }
  for (let i = wrappers.length - 1; i >= 0; i--) {
    rules = [{ at: wrappers[i]!, nodes: rules }];
  }

  let css = emit(rules, { important: cand.important });
  if (extraProps.length === 0 && utility.properties) {
    // hot path: property groups are shared arrays — cache their serialization
    css += propsText(utility.properties);
  } else if (extraProps.length || utility.properties) {
    const seenProps = new Set<string>();
    for (const p of [...extraProps, ...(utility.properties ?? [])]) {
      if (seenProps.has(p.name)) continue;
      seenProps.add(p.name);
      css += emitProperty(p);
    }
  }
  return css;
}

const propsTextCache = new WeakMap<PropDef[], string>();
function propsText(props: PropDef[]): string {
  let text = propsTextCache.get(props);
  if (text === undefined) {
    text = props.map(emitProperty).join("");
    propsTextCache.set(props, text);
  }
  return text;
}

function emitProperty(p: PropDef): string {
  let body = `  syntax: "${p.syntax}";\n`;
  // v4 emits --tw-content's initial-value before inherits; all others after
  if (p.initialFirst && p.initial !== undefined)
    body += `  initial-value: ${p.initial};\n  inherits: ${p.inherits};\n`;
  else {
    body += `  inherits: ${p.inherits};\n`;
    if (p.initial !== undefined) body += `  initial-value: ${p.initial};\n`;
  }
  return `@property ${p.name} {\n${body}}\n`;
}

export function compile(
  tokens: Iterable<string>,
  theme: Theme = defaultTheme,
): CompileResult {
  const matched = new Map<string, string>();
  const unmatched: string[] = [];
  let css = "";
  for (const token of tokens) {
    const one = compileOne(token, theme);
    if (one == null) unmatched.push(token);
    else {
      matched.set(token, one);
      css += one;
    }
  }
  return { css, matched, unmatched };
}
