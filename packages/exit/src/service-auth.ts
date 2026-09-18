import { createHash, timingSafeEqual } from "node:crypto";
import { Redacted } from "effect";
import { ExitAuthenticationError } from "./errors.ts";

export function requireRelayAuthorization(
  authorization: string | null,
  expectedToken: Redacted.Redacted<string>,
): void {
  const prefix = "Bearer ";
  const supplied = authorization?.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : "";
  const matches = timingSafeEqual(
    digest(supplied),
    digest(Redacted.value(expectedToken)),
  );
  if (!matches) {
    throw new ExitAuthenticationError();
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
