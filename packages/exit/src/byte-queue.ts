export class ByteQueue {
  private chunks: Uint8Array[] = [];
  private firstOffset = 0;
  private totalLength = 0;

  get length(): number {
    return this.totalLength;
  }

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    this.chunks.push(chunk);
    this.totalLength += chunk.byteLength;
  }

  take(maxBytes: number): Buffer {
    const length = Math.min(maxBytes, this.totalLength);
    const output = Buffer.allocUnsafe(length);
    let written = 0;

    while (written < length) {
      const first = this.chunks[0];
      if (!first) throw new Error("byte queue is inconsistent");
      const available = first.byteLength - this.firstOffset;
      const copied = Math.min(available, length - written);
      output.set(first.subarray(this.firstOffset, this.firstOffset + copied), written);
      written += copied;
      this.firstOffset += copied;
      this.totalLength -= copied;

      if (this.firstOffset === first.byteLength) {
        this.chunks.shift();
        this.firstOffset = 0;
      }
    }

    return output;
  }
}
