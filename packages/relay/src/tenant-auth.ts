import { createHash, timingSafeEqual } from "node:crypto";
import { Context, Effect, Layer, Redacted } from "effect";
import { RelayAuthenticationError } from "./errors.ts";

export interface TenantIdentity {
  id: string;
}

export class TenantAuthenticator extends Context.Service<
  TenantAuthenticator,
  {
    authenticate(
      authorization: string | null,
    ): Effect.Effect<TenantIdentity, RelayAuthenticationError>;
  }
>()("@shallot/relay/TenantAuthenticator") {}

export type TenantAuthenticatorService = TenantAuthenticator["Service"];

interface TenantCredential {
  id: string;
  tokenDigest: Buffer;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export class StaticTenantAuthenticator implements TenantAuthenticatorService {
  private readonly credentials: TenantCredential[];

  constructor(tokens: ReadonlyMap<string, Redacted.Redacted<string>>) {
    this.credentials = [...tokens].map(([id, token]) => ({
      id,
      tokenDigest: digest(Redacted.value(token)),
    }));
    if (this.credentials.length === 0) {
      throw new Error("at least one tenant credential is required");
    }
  }

  authenticate(
    authorization: string | null,
  ): Effect.Effect<TenantIdentity, RelayAuthenticationError> {
    return Effect.suspend(() => {
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
      return identity
        ? Effect.succeed(identity)
        : Effect.fail(new RelayAuthenticationError());
    });
  }
}

export function tenantAuthenticatorLayer(
  tokens: ReadonlyMap<string, Redacted.Redacted<string>>,
): Layer.Layer<TenantAuthenticator> {
  return Layer.succeed(TenantAuthenticator, new StaticTenantAuthenticator(tokens));
}
