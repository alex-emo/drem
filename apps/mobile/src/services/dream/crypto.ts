let sessionKey: string | null = null

export const setSessionKey = (key: string | null): void => {
  sessionKey = key
}

export const getSessionKey = (): string | null => sessionKey

export const hasSessionKey = (): boolean => Boolean(sessionKey)

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const deriveKey = async (key: string): Promise<CryptoKey> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(key))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const loadKey = async (): Promise<CryptoKey> => {
  if (!sessionKey) throw new Error('聊天记录尚未解锁，请重新登录。')
  return deriveKey(sessionKey)
}

export const encryptText = async (text: string): Promise<string> => {
  if (!text) return ''
  const key = await loadKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text))
  return `${toBase64(iv)}.${toBase64(new Uint8Array(data))}`
}

export const decryptText = async (payload: string): Promise<string> => {
  if (!payload) return ''
  const [iv, data] = payload.split('.')
  if (!iv || !data) throw new Error('聊天记录密文格式不正确。')
  const key = await loadKey()
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) as unknown as BufferSource },
    key,
    fromBase64(data) as unknown as BufferSource,
  )
  return decoder.decode(plain)
}

export const encryptJson = async (value: unknown): Promise<string> => encryptText(JSON.stringify(value))

export const decryptJson = async <T>(payload: string): Promise<T> => JSON.parse(await decryptText(payload)) as T

export const encryptBytes = async (bytes: Uint8Array): Promise<{ iv: string; data: string }> => {
  const key = await loadKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes as unknown as BufferSource)
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(data)) }
}

export const decryptBytes = async (iv: string, data: string): Promise<Uint8Array> => {
  const key = await loadKey()
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) as unknown as BufferSource },
    key,
    fromBase64(data) as unknown as BufferSource,
  )
  return new Uint8Array(plain)
}

export const decryptRawBytes = async (iv: string, bytes: Uint8Array): Promise<Uint8Array> => {
  const key = await loadKey()
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) as unknown as BufferSource },
    key,
    bytes as unknown as BufferSource,
  )
  return new Uint8Array(plain)
}
