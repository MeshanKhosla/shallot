import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { decodeBase64Url } from "./encoding.ts";

export const REQUEST_INFO = Buffer.from("shallot/request/v1");

export const hpke = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});

export function parseX25519PublicKey(value: string): KeyObject {
  const trimmed = value.trim();

  try {
    const key = trimmed.startsWith("-----BEGIN")
      ? createPublicKey(trimmed)
      : createPublicKey({
          key: decodeBase64Url(trimmed, "X25519 public key"),
          format: "der",
          type: "spki",
        });

    if (key.asymmetricKeyType !== "x25519") {
      throw new Error("public key must be an X25519 key");
    }

    return key;
  } catch (error) {
    if (error instanceof Error && error.message.includes("must be an X25519")) {
      throw error;
    }
    throw new Error("X25519 public key must be PEM or base64url SPKI DER");
  }
}

export function parseX25519PrivateKey(value: string): KeyObject {
  const trimmed = value.trim();

  try {
    const key = trimmed.startsWith("-----BEGIN")
      ? createPrivateKey(trimmed)
      : createPrivateKey({
          key: decodeBase64Url(trimmed, "X25519 private key"),
          format: "der",
          type: "pkcs8",
        });

    if (key.asymmetricKeyType !== "x25519") {
      throw new Error("private key must be an X25519 key");
    }
    return key;
  } catch (error) {
    if (error instanceof Error && error.message.includes("must be an X25519")) {
      throw error;
    }
    throw new Error("X25519 private key must be PEM or base64url PKCS8 DER");
  }
}

export async function importX25519PublicKey(key: KeyObject): Promise<CryptoKey> {
  if (key.type !== "public" || key.asymmetricKeyType !== "x25519") {
    throw new Error("Exit public key must be an X25519 public key");
  }
  return hpke.kem.importKey("jwk", key.export({ format: "jwk" }), true);
}

export async function importX25519PrivateKey(key: KeyObject): Promise<CryptoKey> {
  if (key.type !== "private" || key.asymmetricKeyType !== "x25519") {
    throw new Error("Exit private key must be an X25519 private key");
  }
  return hpke.kem.importKey("jwk", key.export({ format: "jwk" }), false);
}
