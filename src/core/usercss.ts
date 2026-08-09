// Support for `<style type="text/tailwindcss">` content — the customization
// channel for pages that are never built (the drop-in build's audience).
// Pure text transforms; the DOM adapter feeds tag contents through and
// injects the result, SSR callers can use these directly.
//
// The scanner is tolerant, not a CSS parser: it tracks braces, strings and
// comments, and leaves everything it doesn't understand byte-for-byte
// intact.
import { compileCandidate } from "./index.ts";
import { emit } from "./emit.ts";
import { parseThemeVars, type Theme } from "./theme.ts";

/** Index of the `}` matching the `{` at `open` (text end if unbalanced). */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) return text.length;
      i = end + 1;
    } else if (ch === '"' || ch === "'") {
      i++;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === "\\") i++;
        i++;
      }
    } else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return text.length;
}

/** Pull top-level @keyframes blocks out of an @theme body. */
function splitThemeBody(body: string): { decls: string; keyframes: string } {
  let decls = "";
  let keyframes = "";
  let i = 0;
  while (i < body.length) {
    if (body[i] === "@" && body.startsWith("@keyframes", i)) {
      const open = body.indexOf("{", i);
      if (open === -1) break;
      const close = matchBrace(body, open);
      keyframes += body.slice(i, close + 1) + "\n";
      i = close + 1;
    } else {
      decls += body[i];
      i++;
    }
  }
  return { decls, keyframes };
}

export interface ExtractedTheme {
  /** vars declared in @theme blocks, in declaration order (later wins) */
  vars: Map<string, string>;
  /**
   * The input with each @theme block lowered to `:root { … }` (plus its
   * @keyframes hoisted alongside) — CSS a browser understands, at the same
   * cascade position.
   */
  css: string;
}

/**
 * Extract `@theme { … }` blocks from user CSS. The returned vars are what
 * make the block *mean* something to the engine: merged into its theme they
 * validate whole utility families (`--color-brand-500` → `bg-brand-500` and
 * friends) and variants (`--breakpoint-*`). `@theme inline/static` modifiers
 * are accepted and treated as plain `@theme` (values are still emitted as
 * `:root` variables and referenced, not inlined).
 */
export function extractTheme(text: string): ExtractedTheme {
  const vars = new Map<string, string>();
  let css = "";
  let i = 0;
  let depth = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const j = end === -1 ? n : end + 2;
      css += text.slice(i, j);
      i = j;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && text[j] !== ch) {
        if (text[j] === "\\") j++;
        j++;
      }
      j++;
      css += text.slice(i, Math.min(j, n));
      i = j;
    } else if (ch === "{") {
      depth++;
      css += ch;
      i++;
    } else if (ch === "}") {
      depth--;
      css += ch;
      i++;
    } else if (depth === 0 && ch === "@" && /^@theme\b/.test(text.slice(i, i + 7))) {
      const open = text.indexOf("{", i);
      if (open === -1) {
        css += text.slice(i);
        break;
      }
      const close = matchBrace(text, open);
      const body = text.slice(open + 1, close);
      const { decls, keyframes } = splitThemeBody(body);
      // "}" so a final declaration without ";" still terminates
      for (const [name, value] of parseThemeVars(decls + "}"))
        vars.set(name, value);
      css += `:root {${decls}}\n${keyframes}`;
      i = close + 1;
    } else {
      css += ch;
      i++;
    }
  }
  return { vars, css };
}

export interface ExpandedApply {
  /** the input with every `@apply` statement expanded in place */
  css: string;
  /** `@apply` utilities the theme couldn't compile (typos, or vars that
   * haven't arrived yet — a grown theme warrants re-expansion) */
  unknown: string[];
}

// grouping at-rules recurse (a rule nested inside keeps its rule context);
// everything else at-rule-shaped (@keyframes, @font-face, …) copies verbatim
const GROUP_AT =
  /^@(media|supports|container|layer|scope|starting-style)\b/;

/**
 * Expand `@apply` statements inside style rules, matching the real
 * compiler's expansion: utilities sort into canonical order, bare utilities
 * splice their declarations in at the `@apply` site, variant-bearing ones
 * become CSS-nesting rules on `&`. `@property` registrations hoist to the
 * end. Everything else passes through byte-for-byte.
 */
export function expandApply(text: string, theme: Theme): ExpandedApply {
  const hoisted: string[] = [];
  const seenProps = new Set<string>();
  const unknown: string[] = [];
  const css =
    transformBody(text, theme, false, hoisted, seenProps, unknown) +
    hoisted.join("");
  return { css, unknown };
}

function transformBody(
  body: string,
  theme: Theme,
  inRule: boolean,
  hoisted: string[],
  seenProps: Set<string>,
  unknown: string[],
): string {
  let out = "";
  let i = 0;
  let segStart = 0;
  const n = body.length;
  while (i < n) {
    const ch = body[i]!;
    if (ch === "/" && body[i + 1] === "*") {
      const end = body.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else if (ch === '"' || ch === "'") {
      i++;
      while (i < n && body[i] !== ch) {
        if (body[i] === "\\") i++;
        i++;
      }
      i++;
    } else if (ch === ";") {
      out += transformStmt(
        body.slice(segStart, i + 1),
        theme,
        inRule,
        hoisted,
        seenProps,
        unknown,
      );
      segStart = i = i + 1;
    } else if (ch === "{") {
      const head = body.slice(segStart, i);
      const close = matchBrace(body, i);
      const trimmed = head.trim();
      if (trimmed.startsWith("@") && !GROUP_AT.test(trimmed)) {
        out += body.slice(segStart, close + 1);
      } else {
        const childInRule = GROUP_AT.test(trimmed) ? inRule : true;
        out +=
          head +
          "{" +
          transformBody(
            body.slice(i + 1, close),
            theme,
            childInRule,
            hoisted,
            seenProps,
            unknown,
          ) +
          "}";
      }
      segStart = i = close + 1;
    } else {
      i++;
    }
  }
  out += transformStmt(
    body.slice(segStart),
    theme,
    inRule,
    hoisted,
    seenProps,
    unknown,
  );
  return out;
}

const APPLY_STMT = /^(\s*)@apply\b([^;]*);?\s*$/;

function transformStmt(
  stmt: string,
  theme: Theme,
  inRule: boolean,
  hoisted: string[],
  seenProps: Set<string>,
  unknown: string[],
): string {
  const m = inRule ? APPLY_STMT.exec(stmt) : null;
  if (m === null) return stmt;
  const compiled = [];
  let out = "\n";
  for (const token of m[2]!.trim().split(/\s+/)) {
    if (!token) continue;
    const c = compileCandidate(token, theme, "&");
    if (c === null) {
      unknown.push(token);
      out += `/* twilightcss: unknown @apply utility: ${token} */\n`;
    } else compiled.push(c);
  }
  // canonical order, like the real compiler (stable sort keeps ties written)
  compiled.sort((a, b) => a.rank - b.rank);
  for (const c of compiled) {
    for (const rule of c.rules) {
      // a bare utility compiles to one `&` rule: splice its declarations in
      // at the @apply site; anything else stays a nested rule/at-rule
      if ("selector" in rule && rule.selector === "&")
        out += emit(rule.nodes, { important: c.important });
      else out += emit([rule], { important: c.important });
    }
    for (const p of c.propsCss.matchAll(/@property\s+(\S+)\s*\{[^}]*\}\n?/g)) {
      if (seenProps.has(p[1]!)) continue;
      seenProps.add(p[1]!);
      hoisted.push(p[0]);
    }
  }
  return out;
}
