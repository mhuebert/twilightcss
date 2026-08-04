// twilight core — pure: tokens → CSS. No DOM. This is the module the browser
// engine, SSR, and the conformance harness all share.
//
// M1 stub: the API shape is real, the table is empty. The differential
// harness runs against this and reports 0% — the engine (M2) raises it.

export interface CompileResult {
  /** Concatenated CSS for all matched tokens, in input order (ordering pass comes with the engine). */
  css: string;
  /** token → its CSS chunk */
  matched: Map<string, string>;
  /** tokens twilight could not compile */
  unmatched: string[];
}

/** CSS for a single candidate, or null if twilight rejects it. */
export function compileOne(_token: string): string | null {
  return null;
}

export function compile(tokens: Iterable<string>): CompileResult {
  const matched = new Map<string, string>();
  const unmatched: string[] = [];
  for (const token of tokens) {
    const css = compileOne(token);
    if (css == null) unmatched.push(token);
    else matched.set(token, css);
  }
  return { css: [...matched.values()].join(""), matched, unmatched };
}
