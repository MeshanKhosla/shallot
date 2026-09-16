import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  createResponseOpener,
  createResponseSealer,
  openRequest,
  sealRequest,
} from "./index.ts";

describe("sealed protocol", () => {
  test("round-trips a request and response frame", async () => {
    const exitKeys = generateKeyPairSync("x25519");
    const requestBody = Buffer.from('{"messages":[{"content":"secret"}]}');
    const client = await sealRequest(requestBody, {
      exitPublicKey: exitKeys.publicKey,
      keyId: "local",
      paddingBytes: 1024,
      requestId: "request-1",
    });
    const exit = await openRequest(client.envelope, exitKeys.privateKey);

    expect(exit.payload).toEqual(requestBody);
    expect(Buffer.from(client.envelope.ciphertext, "base64url").byteLength).toBe(1040);

    const responseBody = Buffer.from("data: [DONE]\n\n");
    const sealer = await createResponseSealer(
      exit.responsePublicKey,
      client.envelope.requestId,
    );
    const frame = await sealer.sealFrame(
      responseBody,
      0,
      "head",
      true,
      256,
    );
    const opener = await createResponseOpener(
      client.responsePrivateKey,
      client.envelope.requestId,
      frame.encapsulatedKey!,
    );

    expect(await opener.openFrame(frame, 0)).toEqual(responseBody);
  });

  test("authenticates response frame metadata", async () => {
    const exitKeys = generateKeyPairSync("x25519");
    const client = await sealRequest(Buffer.from("request"), {
      exitPublicKey: exitKeys.publicKey,
      keyId: "local",
      paddingBytes: 256,
    });
    const exit = await openRequest(client.envelope, exitKeys.privateKey);
    const sealer = await createResponseSealer(
      exit.responsePublicKey,
      client.envelope.requestId,
    );
    const frame = await sealer.sealFrame(
      Buffer.from("response"),
      0,
      "head",
      true,
      256,
    );
    const opener = await createResponseOpener(
      client.responsePrivateKey,
      client.envelope.requestId,
      frame.encapsulatedKey!,
    );

    await expect(opener.openFrame({ ...frame, final: false }, 0)).rejects.toThrow();
  });
});
