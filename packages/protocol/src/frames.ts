import type { RecipientContext, SenderContext } from "@hpke/core";
import { decodeBase64Url, encodeBase64Url } from "./encoding.ts";
import { hpke } from "./hpke.ts";
import { padPayload, unpadPayload } from "./padding.ts";
import {
  frameAad,
  parseSealedFrame,
  type ResponseFrameKind,
  responseInfo,
  SEALED_FRAME_VERSION,
  type SealedFrame,
} from "./wire.ts";

export interface ResponseSealer {
  readonly encapsulatedKey: string;
  sealFrame(
    payload: Uint8Array,
    sequence: number,
    kind: ResponseFrameKind,
    final: boolean,
    paddingBytes: number,
  ): Promise<SealedFrame>;
}

export interface ResponseOpener {
  openFrame(frame: SealedFrame, expectedSequence: number): Promise<Buffer>;
}

class HpkeResponseSealer implements ResponseSealer {
  readonly encapsulatedKey: string;

  constructor(
    private readonly context: SenderContext,
    private readonly requestId: string,
  ) {
    this.encapsulatedKey = encodeBase64Url(context.enc);
  }

  async sealFrame(
    payload: Uint8Array,
    sequence: number,
    kind: ResponseFrameKind,
    final: boolean,
    paddingBytes: number,
  ): Promise<SealedFrame> {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error("response frame sequence must be a non-negative integer");
    }
    if ((sequence === 0) !== (kind === "head")) {
      throw new Error("response head must be frame zero");
    }

    const ciphertext = await this.context.seal(
      padPayload(payload, paddingBytes),
      frameAad(this.requestId, sequence, kind, final),
    );
    return {
      version: SEALED_FRAME_VERSION,
      requestId: this.requestId,
      sequence,
      kind,
      final,
      ...(sequence === 0 ? { encapsulatedKey: this.encapsulatedKey } : {}),
      ciphertext: encodeBase64Url(ciphertext),
    };
  }
}

class HpkeResponseOpener implements ResponseOpener {
  constructor(
    private readonly context: RecipientContext,
    private readonly requestId: string,
  ) {}

  async openFrame(frame: SealedFrame, expectedSequence: number): Promise<Buffer> {
    const parsed = parseSealedFrame(frame);
    if (parsed.requestId !== this.requestId) {
      throw new Error("response frame request ID mismatch");
    }
    if (parsed.sequence !== expectedSequence) {
      throw new Error("response frame sequence mismatch");
    }

    const plaintext = await this.context.open(
      decodeBase64Url(parsed.ciphertext, "response ciphertext"),
      frameAad(parsed.requestId, parsed.sequence, parsed.kind, parsed.final),
    );
    return unpadPayload(new Uint8Array(plaintext));
  }
}

export async function createResponseSealer(
  responsePublicKey: CryptoKey,
  requestId: string,
): Promise<ResponseSealer> {
  const context = await hpke.createSenderContext({
    recipientPublicKey: responsePublicKey,
    info: responseInfo(requestId),
  });
  return new HpkeResponseSealer(context, requestId);
}

export async function createResponseOpener(
  responsePrivateKey: CryptoKey,
  requestId: string,
  encapsulatedKey: string,
): Promise<ResponseOpener> {
  const context = await hpke.createRecipientContext({
    recipientKey: responsePrivateKey,
    enc: decodeBase64Url(encapsulatedKey, "encapsulated response key"),
    info: responseInfo(requestId),
  });
  return new HpkeResponseOpener(context, requestId);
}
