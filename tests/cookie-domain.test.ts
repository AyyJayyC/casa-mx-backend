import { describe, it, expect } from "vitest";
import { deriveCookieDomain } from "../src/utils/cookies.js";

/**
 * Regression guard: the CSRF + auth cookies must be set on the shared
 * registrable domain so the SPA (casa-mx.com) can read the readable
 * `csrfToken` cookie that the API (api.casa-mx.com) sets. If this returns
 * undefined in production, the SPA never sends `x-csrf-token` and every
 * cookie-authenticated POST fails with 403.
 */
describe("deriveCookieDomain", () => {
  it("returns the shared domain for production (leading dot)", () => {
    expect(deriveCookieDomain("https://casa-mx.com")).toBe(".casa-mx.com");
  });

  it("strips www so all subdomains share the cookie", () => {
    expect(deriveCookieDomain("https://www.casa-mx.com")).toBe(".casa-mx.com");
  });

  it("returns undefined for localhost / loopback (no domain)", () => {
    expect(deriveCookieDomain("http://localhost:3000")).toBeUndefined();
    expect(deriveCookieDomain("http://127.0.0.1:3000")).toBeUndefined();
    expect(deriveCookieDomain("http://0.0.0.0:3000")).toBeUndefined();
  });

  it("returns undefined for an unparseable URL", () => {
    expect(deriveCookieDomain("not a url")).toBeUndefined();
  });
});
