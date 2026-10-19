import type { FastifyReply } from "fastify";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** CSRF tokens are only needed on state-changing requests. */
export function shouldIssueCsrf(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Generate the double-submit pair (`_csrf` secret + readable `csrfToken`) and
 * mirror the readable half into a cookie. No-op when CSRF is not registered
 * (e.g. the test env with security disabled).
 */
export function issueCsrfToken(
  reply: FastifyReply,
  cookieDomain?: string,
): string {
  const generate = (reply as unknown as { generateCsrf?: () => string })
    .generateCsrf;
  if (typeof generate !== "function") return "";

  try {
    const token = generate.call(reply);
    if (!token) return "";

    reply.setCookie("csrfToken", token, {
      httpOnly: false,
      sameSite: "lax",
      secure: true,
      path: "/",
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    });

    return token;
  } catch {
    return "";
  }
}
