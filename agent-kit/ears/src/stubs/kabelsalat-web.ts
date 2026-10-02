// Node stub for @kabelsalat/web. Its published dist is a browser IIFE with no ESM
// exports, and the ears server never uses Kabelsalat; @strudel/core only imports
// SalatRepl to offer it in the browser.
export class SalatRepl {
  constructor() {
    throw new Error("Kabelsalat is browser-only and not available in the ears server");
  }
}
