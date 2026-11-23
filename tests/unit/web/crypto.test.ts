import { beforeEach, describe, expect, it } from "vitest";
import {
  decryptBytes,
  decryptRawBytes,
  decryptText,
  encryptBytes,
  encryptText,
  getSessionKey,
  hasSessionKey,
  setSessionKey,
} from "@web/lib/crypto";

beforeEach(() => setSessionKey("session-key-for-tests"));

describe("会话密钥", () => {
  it("set/get/hasSessionKey", () => {
    setSessionKey(null);
    expect(getSessionKey()).toBeNull();
    expect(hasSessionKey()).toBe(false);
    setSessionKey("k1");
    expect(getSessionKey()).toBe("k1");
    expect(hasSessionKey()).toBe(true);
  });

  it("没有密钥时加解密都报错", async () => {
    setSessionKey(null);
    await expect(encryptText("x")).rejects.toThrowError(/密钥/);
    await expect(decryptText({ iv: "a", data: "b" })).rejects.toThrowError(/密钥/);
  });
});

describe("文本加解密", () => {
  it("往返还原 UTF-8 文本", async () => {
    const plain = "你好 Dream，emoji 🙂\n第二行";
    const payload = await encryptText(plain);
    expect(payload.iv).not.toBe(payload.data);
    expect(payload.data).not.toContain(plain);
    expect(await decryptText(payload)).toBe(plain);
  });

  it("每次使用随机 IV，相同明文密文不同", async () => {
    const a = await encryptText("same");
    const b = await encryptText("same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it("换密钥后无法解密", async () => {
    const payload = await encryptText("secret");
    setSessionKey("another-key");
    await expect(decryptText(payload)).rejects.toThrow();
  });

  it("密文被篡改时解密失败（AES-GCM 认证）", async () => {
    const payload = await encryptText("secret");
    const bytes = Uint8Array.from(atob(payload.data), (char) => char.charCodeAt(0));
    bytes[0] ^= 0xff;
    const tampered = { iv: payload.iv, data: btoa(String.fromCharCode(...bytes)) };
    await expect(decryptText(tampered)).rejects.toThrow();
  });
});

describe("字节加解密", () => {
  it("往返还原任意字节", async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const payload = await encryptBytes(bytes);
    expect(Array.from(await decryptBytes(payload))).toEqual(Array.from(bytes));
  });

  it("decryptRawBytes 使用独立 iv + 裸密文", async () => {
    const bytes = new TextEncoder().encode("streamed backup");
    const payload = await encryptBytes(bytes);
    const raw = Uint8Array.from(atob(payload.data), (char) => char.charCodeAt(0));
    expect(Array.from(await decryptRawBytes(payload.iv, raw))).toEqual(Array.from(bytes));
  });
});
