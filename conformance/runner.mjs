// Differential runner: oracle vs twilight, token by token.
//
// Statuses:
//   match      — both accept, normalized CSS identical            (pass)
//   bothReject — both reject the candidate                        (pass)
//   mismatch   — both accept, CSS differs
//   missing    — oracle accepts, twilight rejects (engine gap)
//   extra      — oracle rejects, twilight accepts (engine overreach)
//   error      — a side produced CSS lightningcss cannot parse
import { tryNormalizeCss } from "./normalize.mjs";

export function diffToken(token, oracleCss, twilightCss) {
  if (oracleCss == null && twilightCss == null)
    return { token, status: "bothReject" };
  if (oracleCss != null && twilightCss == null)
    return { token, status: "missing", oracle: oracleCss };
  if (oracleCss == null && twilightCss != null)
    return { token, status: "extra", twilight: twilightCss };
  // byte-identical needs no normalization (and covers CSS that lightningcss
  // cannot parse, e.g. v4's ::selection::placeholder composites)
  if (oracleCss === twilightCss) return { token, status: "match" };
  const o = tryNormalizeCss(oracleCss);
  const t = tryNormalizeCss(twilightCss);
  if (!o.ok || !t.ok)
    return {
      token,
      status: "error",
      oracle: oracleCss,
      twilight: twilightCss,
      error: [!o.ok && `oracle: ${o.error}`, !t.ok && `twilight: ${t.error}`]
        .filter(Boolean)
        .join("; "),
    };
  if (o.css === t.css) return { token, status: "match" };
  return {
    token,
    status: "mismatch",
    oracle: oracleCss,
    twilight: twilightCss,
    oracleNorm: o.css,
    twilightNorm: t.css,
  };
}

/**
 * @param tokens string[]
 * @param oracle {css(token): string|null}
 * @param engine {css(token): string|null}
 */
export function runDiff(tokens, oracle, engine) {
  const results = tokens.map((token) =>
    diffToken(token, oracle.css(token), engine.css(token)),
  );
  const by = {};
  for (const r of results) by[r.status] = (by[r.status] ?? 0) + 1;
  const pass = (by.match ?? 0) + (by.bothReject ?? 0);
  return {
    results,
    summary: {
      total: results.length,
      pass,
      passRate: results.length ? pass / results.length : 1,
      byStatus: by,
    },
  };
}

const INDENT = "    ";
export function formatFailure(r) {
  const block = (label, css) =>
    `${INDENT}${label}:\n` +
    (css == null
      ? `${INDENT}${INDENT}(rejected)\n`
      : css
          .trimEnd()
          .split("\n")
          .map((l) => INDENT + INDENT + l)
          .join("\n") + "\n");
  let out = `  ${r.token}  [${r.status}]\n`;
  if (r.error) out += `${INDENT}${r.error}\n`;
  out += block("oracle", r.oracle ?? null);
  out += block("twilight", r.twilight ?? null);
  return out;
}

export function formatReport({ results, summary }, { maxFailures = 25 } = {}) {
  const failures = results.filter(
    (r) => r.status !== "match" && r.status !== "bothReject",
  );
  let out = `pass ${summary.pass}/${summary.total} (${(summary.passRate * 100).toFixed(2)}%)  ${JSON.stringify(summary.byStatus)}\n`;
  for (const r of failures.slice(0, maxFailures)) out += formatFailure(r);
  if (failures.length > maxFailures)
    out += `  … and ${failures.length - maxFailures} more failures\n`;
  return out;
}
