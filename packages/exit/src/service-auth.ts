import { createHash, timingSafeEqual } from "node:crypto";
import { ExitHttpError } from "./errors.ts";

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
    throw new ExitHttpError(401, "Relay authentication failed", "authentication_error");
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
