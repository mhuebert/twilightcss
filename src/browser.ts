// The drop-in browser build: one classic <script src>, zero configuration.
// Included from <head>, it starts observing document.documentElement
// immediately, so body content is styled as the parser streams it in —
// before first paint. Theme + preflight are inlined; tw/observe are exposed
// on globalThis.twilightcss as an escape hatch. Including the script twice
// is a no-op (the second copy would otherwise create a second engine).
import { tw, observe } from "./index.ts";

type Global = typeof globalThis & {
  twilightcss?: { tw: typeof tw; observe: typeof observe };
};

const g = globalThis as Global;
if (!g.twilightcss) {
  g.twilightcss = { tw, observe };
  observe(document.documentElement);
}
