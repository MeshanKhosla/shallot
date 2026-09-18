import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { openRequest, sealRequest } from "@shallot/protocol";
import { sealProviderResponse } from "../src/response-sealer.ts";

async function responsePublicKey(): Promise<CryptoKey> {
  const exitKeys = generateKeyPairSync("x25519");
  const sealed = await sealRequest(Buffer.from("{}"), {
    exitPublicKey: exitKeys.publicKey,
    keyId: "test-key",
    paddingBytes: 64,
  });
  const opened = await openRequest(sealed.envelope, exitKeys.privateKey);
  return opened.responsePublicKey;
}

describe("encrypted response backpressure", () => {
  test("cancels the provider body when the downstream consumer stops", async () => {
    let cancelled = false;
    const providerBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(Buffer.from("provider data"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await sealProviderResponse(
      new Response(providerBody),
      await responsePublicKey(),
      "00000000-0000-4000-8000-000000000000",
      {
        responsePaddingBytes: 64,
        responseFlushMs: 5,
        maxResponseBytes: 1024,
      },
    );

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    expect((await reader?.read())?.done).toBeFalse();
    await reader?.cancel("test cancellation");

    expect(cancelled).toBeTrue();
  });

  test("flushes one provider chunk without waiting for another", async () => {
    let cancelled = false;
    const providerBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("one chunk"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await sealProviderResponse(
      new Response(providerBody),
      await responsePublicKey(),
      "00000000-0000-4000-8000-000000000001",
      {
        responsePaddingBytes: 64,
        responseFlushMs: 5,
        maxResponseBytes: 1024,
      },
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();

    const dataFrame = await Promise.race([
      reader?.read(),
      Bun.sleep(100).then(() => "timed out" as const),
    ]);
    expect(dataFrame).not.toBe("timed out");

    const pendingRead = reader?.read();
    await Bun.sleep(5);
    await reader?.cancel("test active cancellation");
    await pendingRead;
    expect(cancelled).toBeTrue();
  });
});
