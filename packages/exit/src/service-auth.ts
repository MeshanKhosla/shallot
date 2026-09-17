import { createHash, timingSafeEqual } from "node:crypto";
import { ExitAuthenticationError } from "./errors.ts";

export function requireRelayAuthorization(
  authorization: string | null,
  expectedToken: string,
): void {
  const prefix = "Bearer ";
  const supplied = authorization?.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : "";
  const matches = timingSafeEqual(digest(supplied), digest(expectedToken));
  if (!matches) {
    throw new ExitAuthenticationError();
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
