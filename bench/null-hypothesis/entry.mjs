// M0 null hypothesis: drive the real tailwindcss@4 compiler in a browser bundle.
// Bundled by measure.mjs to record gzipped size; the same module runs in Node for latency.
import { compile } from "tailwindcss";
import theme from "tailwindcss/theme.css";

export async function createOracleEngine() {
  const compiled = await compile(theme + "\n@tailwind utilities;", {
    base: "/",
    async loadStylesheet() {
      throw new Error("no imports at runtime");
    },
    async loadModule() {
      throw new Error("no modules at runtime");
    },
  });
  return {
    build: (classes) => compiled.build(classes),
  };
}
