import { webcrypto } from "node:crypto";

// jsdom 里没有 crypto.subtle（lib/crypto.ts 依赖它），补一个 Node 实现。
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// jsdom 的 Blob 没有 stream()（backup.ts 的 gzip 依赖它），用 arrayBuffer 兜底实现。
if (typeof Blob !== "undefined" && typeof Blob.prototype.stream !== "function") {
  Object.defineProperty(Blob.prototype, "stream", {
    configurable: true,
    value(this: Blob) {
      const self = this;
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new Uint8Array(await self.arrayBuffer()));
          controller.close();
        },
      });
    },
  });
}
