// Candidate parser. Mirrors v4's candidate grammar:
//   candidate := (variant ':')* '!'? root ('-' value)? ('/' modifier)? '!'?
// Arbitrary segments ([...] and (...)) may contain ':' '/' '-'; splitting is
// bracket-aware throughout. This module only tokenizes — validity of roots,
// values, and variants is decided by the tables that consume the parts.

const EMPTY: string[] = [];

export interface Candidate {
  /** variant names, left to right, as written (e.g. ["md", "hover"]) */
  variants: string[];
  important: boolean;
  /** leading '-' (negative utility) */
  negative: boolean;
  /** everything after variants/negation, before value split: handled by utilities.ts */
  base: string;
  /** raw token as written (class name source) */
  raw: string;
  /** modifier after '/', without brackets interpretation (raw text) */
  modifier: string | null;
}

/** Split on `sep` at bracket depth 0. Returns null on unbalanced brackets. */
export function splitTop(s: string, sep: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") {
      depth--;
      if (depth < 0) return null;
    } else if (ch === sep && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) return null;
  parts.push(s.slice(start));
  return parts;
}

const SIMPLE = /^[a-zA-Z][\w.-]*$/;

export function parseCandidate(raw: string): Candidate | null {
  if (!raw) return null;
  // fast path: plain utilities without variants/brackets/modifiers
  if (SIMPLE.test(raw)) {
    return {
      variants: EMPTY,
      important: false,
      negative: false,
      base: raw,
      raw,
      modifier: null,
    };
  }
  const segments = splitTop(raw, ":");
  if (segments === null) return null;
  if (segments.some((s) => s === "")) return null;
  const variants = segments.slice(0, -1);
  let base = segments[segments.length - 1]!;

  let important = false;
  if (base.endsWith("!")) {
    important = true;
    base = base.slice(0, -1);
  } else if (base.startsWith("!")) {
    // v3-style leading important — accepted by v4's parser as well
    important = true;
    base = base.slice(1);
  }
  if (!base) return null;

  // modifier: last top-level '/'
  let modifier: string | null = null;
  const slash = splitTop(base, "/");
  if (slash === null) return null;
  if (slash.length > 2) {
    // Only one modifier allowed — except fraction values like w-1/2 which the
    // utility layer re-joins; leave bases with >1 slash intact for it.
  }
  if (slash.length === 2) {
    base = slash[0]!;
    modifier = slash[1]!;
    if (modifier === "") return null;
  } else if (slash.length > 2) {
    return null;
  }

  let negative = false;
  if (base.startsWith("-")) {
    negative = true;
    base = base.slice(1);
  }
  if (!base) return null;

  return { variants, important, negative, base, raw, modifier };
}
