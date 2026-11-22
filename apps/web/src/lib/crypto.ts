let sessionKey: string | null = null;
let cachedCryptoKey: CryptoKey | null = null;

export function setSessionKey(key: string | null): void {
  sessionKey = key;
  cachedCryptoKey = null;
}

export function getSessionKey(): string | null {
  return sessionKey;
}

export function hasSessionKey(): boolean {
  return sessionKey !== null;
}

async function aesKey(): Promise<CryptoKey> {
  if (!sessionKey) throw new Error("尚未获取聊天记录密钥，请重新登录。");
  if (cachedCryptoKey) return cachedCryptoKey;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionKey));
  cachedCryptoKey = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
  return cachedCryptoKey;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export interface EncryptedText {
  iv: string;
  data: string;
}

export async function encryptText(text: string): Promise<EncryptedText> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(text),
  );
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(cipher)) };
}

export async function decryptText(payload: EncryptedText): Promise<string> {
  const key = await aesKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(payload.iv) as unknown as BufferSource },
    key,
    fromBase64(payload.data) as unknown as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

export async function encryptBytes(bytes: Uint8Array): Promise<EncryptedText> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    bytes as unknown as BufferSource,
  );
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(cipher)) };
}

export async function decryptBytes(payload: EncryptedText): Promise<Uint8Array> {
  const key = await aesKey();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(payload.iv) as unknown as BufferSource },
    key,
    fromBase64(payload.data) as unknown as BufferSource,
  );
  return new Uint8Array(plain);
}
