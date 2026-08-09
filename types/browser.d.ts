// The drop-in build is all side effects: it starts observing the document on
// load and exposes the default engine's tw/observe on globalThis.twilightcss.
import type { tw, observe } from "./index.d.ts";

declare global {
  var twilightcss: { tw: typeof tw; observe: typeof observe } | undefined;
}

export {};
