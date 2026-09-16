import { createHash, timingSafeEqual } from "node:crypto";
import { RelayHttpError } from "./errors.ts";

export interface TenantIdentity {
  id: string;
}

export interface TenantAuthenticator {
  authenticate(authorization: string | null): TenantIdentity;
}

interface TenantCredential {
  id: string;
  tokenDigest: Buffer;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export class StaticTenantAuthenticator implements TenantAuthenticator {
  private readonly credentials: TenantCredential[];

  constructor(tokens: ReadonlyMap<string, string>) {
    this.credentials = [...tokens].map(([id, token]) => ({
      id,
      tokenDigest: digest(token),
    }));
    if (this.credentials.length === 0) {
      throw new Error("at least one tenant credential is required");
    }
  }

  authenticate(authorization: string | null): TenantIdentity {
    const supplied = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    const suppliedDigest = digest(supplied);
    let identity: TenantIdentity | undefined;

    for (const credential of this.credentials) {
      if (timingSafeEqual(suppliedDigest, credential.tokenDigest)) {
        identity = { id: credential.id };
      }
    }
    if (!identity) {
      throw new RelayHttpError(
        401,
        "Tenant authentication failed",
        "authentication_error",
      );
    }
    return identity;
  }
}
