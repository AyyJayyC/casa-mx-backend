import { createHash, randomBytes } from "node:crypto";

export interface GeneratedPublisherKey {
  /** The raw key — shown to the user exactly once; never persisted. */
  raw: string;
  /** sha256 hex of the raw key, as stored in the DB. */
  keyHash: string;
  /** Short display prefix, e.g. "cmx_pub_ab12". */
  keyPrefix: string;
}

/**
 * Generate a Casa MX publisher API key. Shared by the create-key CLI and the
 * self-serve /users/me/api-keys route so the format stays in one place.
 */
export function generatePublisherKey(): GeneratedPublisherKey {
  const raw = "cmx_pub_" + randomBytes(32).toString("base64url");
  return {
    raw,
    keyHash: createHash("sha256").update(raw).digest("hex"),
    keyPrefix: raw.slice(0, 12),
  };
}
