/**
 * twilightcss/core — pure: tokens → CSS strings. No DOM.
 * Runs anywhere (SSR, tests, workers); the conformance harness and the
 * browser engine call the same functions.
 */

/** Parsed theme: the CSS custom properties the utility tables resolve against. */
export interface Theme {
  /** var name (with leading `--`) → value, whitespace-collapsed */
  vars: Map<string, string>;
  /** deprecated `inline reference` values (bare --shadow, --radius, …) */
  inline: Map<string, string>;
  get(name: string): string | undefined;
  has(name: string): boolean;
}

export interface CompileResult {
  /** Concatenated CSS for all matched tokens, in canonical order. */
  css: string;
  /** token → its CSS chunk */
  matched: Map<string, string>;
  /** tokens twilight could not compile */
  unmatched: string[];
}

export interface CompiledRule {
  /** the token's CSS */
  css: string;
  /**
   * Position in Tailwind v4's canonical order. Sorting rules by rank
   * (stable, so equal ranks keep first-seen order) reproduces the order the
   * real compiler emits, which is what decides between two
   * equal-specificity utilities that land on the same element.
   */
  rank: number;
}

/** CSS and canonical rank for one candidate, or null if twilight rejects it. */
export declare function compileOne(
  token: string,
  theme?: Theme,
): CompiledRule | null;

export declare function compile(
  tokens: Iterable<string>,
  theme?: Theme,
): CompileResult;

/**
 * Build a Theme from flattened `:root { --… }` CSS text (the shape produced
 * by Tailwind v4's `@theme` — see assets/theme.mjs for the default).
 */
export declare function createTheme(
  themeCss: string,
  inlineVars?: Record<string, string>,
): Theme;

/** Extract `--name: value` pairs from CSS text (skips @keyframes blocks). */
export declare function parseThemeVars(css: string): Map<string, string>;

/** The default Tailwind v4 theme, parsed from the shipped assets. */
export declare const defaultTheme: Theme;
