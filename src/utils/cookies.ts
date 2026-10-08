/**
 * Derive the cookie domain shared across the app and API subdomains.
 *
 * The SPA runs on the registrable domain (e.g. casa-mx.com) while the API runs
 * on a subdomain (api.casa-mx.com). Any cookie the SPA must READ (the readable
 * `csrfToken`) — or that must reach the API — has to be set on the shared
 * domain (`.casa-mx.com`). Host-only cookies set by the API are invisible to
 * `document.cookie` on the SPA, which breaks the double-submit CSRF flow.
 *
 * Returns `undefined` for local development (no domain) so localhost works.
 */
export function deriveCookieDomain(frontendUrl: string): string | undefined {
  const isLocal =
    frontendUrl.includes("localhost") ||
    frontendUrl.includes("127.0.0.1") ||
    frontendUrl.includes("0.0.0.0");
  if (isLocal) return undefined;
  try {
    // Strip a leading "www." so cookies cover every subdomain.
    return `.${new URL(frontendUrl).hostname.replace(/^www\./, "")}`;
  } catch {
    return undefined;
  }
}
