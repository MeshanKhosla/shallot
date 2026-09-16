import type { KeyObject } from "node:crypto";
import { decodeBase64Url, encodeBase64Url } from "./encoding.ts";
import {
  hpke,
  importX25519PrivateKey,
  importX25519PublicKey,
  REQUEST_INFO,
} from "./hpke.ts";
import { padPayload, unpadPayload } from "./padding.ts";
import {
  parseSealedRequest,
  requestAad,
  SEALED_REQUEST_VERSION,
  type SealedRequest,
} from "./wire.ts";

export interface SealedRequestContext {
  envelope: SealedRequest;
  responsePrivateKey: CryptoKey;
}

export interface OpenedRequestContext {
  payload: Buffer;
  responsePublicKey: CryptoKey;
}

export interface SealRequestOptions {
  exitPublicKey: KeyObject;
  keyId: string;
  paddingBytes: number;
  requestId?: string;
}

export async function sealRequest(
  payload: Uint8Array,
  options: SealRequestOptions,
): Promise<SealedRequestContext> {
  const requestId = options.requestId ?? crypto.randomUUID();
  if (options.keyId.length === 0) throw new Error("Exit key ID is required");

  const recipientPublicKey = await importX25519PublicKey(options.exitPublicKey);
  const responseKeyPair = await hpke.kem.generateKeyPair();
  const serializedResponseKey = await hpke.kem.serializePublicKey(
    responseKeyPair.publicKey,
  );
  const responsePublicKey = encodeBase64Url(serializedResponseKey);
  const sealed = await hpke.seal(
    { recipientPublicKey, info: REQUEST_INFO },
    padPayload(payload, options.paddingBytes),
    requestAad(requestId, options.keyId, responsePublicKey),
  );

  return {
    envelope: {
      version: SEALED_REQUEST_VERSION,
      requestId,
      keyId: options.keyId,
      encapsulatedKey: encodeBase64Url(sealed.enc),
      responsePublicKey,
      ciphertext: encodeBase64Url(sealed.ct),
    },
    responsePrivateKey: responseKeyPair.privateKey,
  };
}

export async function openRequest(
  input: SealedRequest,
  exitPrivateKey: KeyObject,
): Promise<OpenedRequestContext> {
  const envelope = parseSealedRequest(input);
  const recipientKey = await importX25519PrivateKey(exitPrivateKey);
  const responsePublicKey = await hpke.kem.deserializePublicKey(
    decodeBase64Url(envelope.responsePublicKey, "response public key"),
  );
  const plaintext = await hpke.open(
    {
      recipientKey,
      enc: decodeBase64Url(
        envelope.encapsulatedKey,
        "encapsulated request key",
      ),
      info: REQUEST_INFO,
    },
    decodeBase64Url(envelope.ciphertext, "request ciphertext"),
    requestAad(envelope.requestId, envelope.keyId, envelope.responsePublicKey),
  );

  return {
    payload: unpadPayload(new Uint8Array(plaintext)),
    responsePublicKey,
  };
}
