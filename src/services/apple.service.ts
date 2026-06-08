import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function generateAppleClientSecret(): string {
  if (
    !env.APPLE_CLIENT_ID ||
    !env.APPLE_TEAM_ID ||
    !env.APPLE_KEY_ID ||
    !env.APPLE_PRIVATE_KEY
  ) {
    throw new Error(
      "Apple Sign-In is not configured. Set APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY.",
    );
  }

  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iss: env.APPLE_TEAM_ID,
      sub: env.APPLE_CLIENT_ID,
      aud: "https://appleid.apple.com",
      iat: now,
      exp: now + 3600,
    },
    env.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    {
      algorithm: "ES256",
      keyid: env.APPLE_KEY_ID,
      header: { alg: "ES256", kid: env.APPLE_KEY_ID },
    },
  );
}
