import { apiBase, getToken } from './auth.js'
import { decryptBytes, decryptRawBytes, encryptBytes, hasSessionKey, setSessionKey } from './crypto.js'
import {
  loadAllSessions,
  loadSessionSummaries,
  migrateAppEncryption,
  saveSession,
} from '../chat/db.js'
import { getVisibleMessages, normalizeSession } from '../chat/branches.js'
import type { Message as AppMessage, Session } from '../chat/types.js'

interface BackupPayload {
  payload?: string
  updatedAt: string
  size: number
  iv?: string
  version?: number
  legacy?: boolean
}

const MAX_BACKUP_BYTES = 20 * 1024 * 1024

interface CloudInfo {
  key: string
  legacyKey?: string
  backup: BackupPayload | null
}

type WebMessage = {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  status: string
  createdAt: number
}

type WebConversation = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export type BackupData = {
  format: string
  version: number
  exportedAt?: string
  conversations?: WebConversation[]
  messages?: WebMessage[]
  sessions?: Session[]
  tombstones?: Array<{ id: string; deletedAt: number }>
}

export interface AppCloudState {
  key: string
  backup: BackupPayload | null
  merged: number
  localSessions: number
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  let response: Response
  try {
    response = await fetch(`${apiBase()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error('云端同步超时，请检查网络后重试。')
    throw error
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(data?.error?.message ?? `云端同步失败（${response.status}）`)
  }
  return (await response.json()) as T
}

const gzip = async (text: string): Promise<Uint8Array> => {
  if (typeof CompressionStream === 'undefined') return new TextEncoder().encode(text)
  const blob = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
  return new Uint8Array(await blob.arrayBuffer())
}

const gunzip = async (bytes: Uint8Array): Promise<string> => {
  if (typeof DecompressionStream === 'undefined') return new TextDecoder().decode(bytes)
  return new Response(
    new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).text()
}

const decodePayload = (payload: string): { iv: string; data: string } => {
  const [tag, iv, data] = payload.split('.')
  if (tag !== 'dream1' || !iv || !data) throw new Error('云端备份格式不正确。')
  return { iv, data }
}

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const fetchBackupStream = async (info: CloudInfo): Promise<{ iv: string; bytes: Uint8Array }> => {
  if (info.backup?.payload) {
    const { iv, data } = decodePayload(info.backup.payload)
    return { iv, bytes: await decryptBytes(iv, data) }
  }
  if (info.backup?.legacy) {
    const legacy = await api<CloudInfo>('/backup')
    if (!legacy.backup?.payload) throw new Error('云端备份格式不正确。')
    const { iv, data } = decodePayload(legacy.backup.payload)
    return { iv, bytes: await decryptBytes(iv, data) }
  }
  const iv = info.backup?.iv
  if (!iv) throw new Error('云端备份格式不正确。')
  const token = getToken()
  const response = await fetch(`${apiBase()}/backup/stream`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(data?.error?.message ?? `云端备份下载失败（${response.status}）`)
  }
  return { iv, bytes: await decryptRawBytes(iv, new Uint8Array(await response.arrayBuffer())) }
}

const readBackup = async (info: CloudInfo): Promise<BackupData> => {
  const { bytes } = await fetchBackupStream(info)
  return JSON.parse(await gunzip(bytes)) as BackupData
}

const assistantText = (message: Extract<AppMessage, { role: 'assistant' }>): string =>
  message.blocks
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')

const assistantThinking = (message: Extract<AppMessage, { role: 'assistant' }>): string =>
  message.blocks
    .filter((block): block is Extract<typeof block, { type: 'thinking' }> => block.type === 'thinking')
    .map((block) => block.thinking)
    .join('')

export const toWeb = (sessions: Session[]): BackupData => {
  const conversations: WebConversation[] = []
  const messages: WebMessage[] = []
  for (const session of sessions) {
    conversations.push({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })
    for (const message of getVisibleMessages(normalizeSession(session))) {
      const assistant = message.role === 'assistant' ? message : null
      messages.push({
        id: `${session.id}:${message.id}`,
        conversationId: session.id,
        role: message.role,
        content: message.role === 'user' ? message.content : assistantText(message),
        reasoning: assistant ? assistantThinking(assistant) : undefined,
        status: assistant?.status ?? 'done',
        createdAt: message.createdAt,
      })
    }
  }
  return { format: 'dream-backup', version: 1, exportedAt: new Date().toISOString(), conversations, messages, sessions }
}

export const fromWeb = (data: BackupData): Session[] => {
  const byConversation = new Map<string, WebMessage[]>()
  for (const message of data.messages ?? []) {
    const list = byConversation.get(message.conversationId) ?? []
    list.push(message)
    byConversation.set(message.conversationId, list)
  }
  const sessions = new Map((data.sessions ?? []).map((session) => [session.id, session]))
  const linear = (data.conversations ?? []).map((conversation) => {
    const messages: AppMessage[] = (byConversation.get(conversation.id) ?? [])
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((message) =>
        message.role === 'user'
          ? {
              id: message.id,
              role: 'user' as const,
              content: message.content,
              files: [],
              createdAt: message.createdAt,
            }
          : {
              id: message.id,
              role: 'assistant' as const,
              createdAt: message.createdAt,
              model: null,
              prefix: false,
              status: 'done' as const,
              blocks: [
                { type: 'text' as const, text: message.content },
                ...(message.reasoning ? [{ type: 'thinking' as const, thinking: message.reasoning }] : []),
              ],
            },
      )
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages,
    }
  })
  for (const session of linear) {
    const existing = sessions.get(session.id)
    if (!existing || session.updatedAt > existing.updatedAt) sessions.set(session.id, session)
  }
  return [...sessions.values()].map(normalizeSession)
}

const mergeSessions = async (incoming: Session[]): Promise<number> => {
  const local = new Map((await loadSessionSummaries()).map((session) => [session.id, session]))
  let merged = 0
  for (const session of incoming) {
    const existing = local.get(session.id)
    if (existing && existing.updatedAt >= session.updatedAt) continue
    await saveSession(session)
    merged += 1
  }
  return merged
}

async function fetchAppCloudInfo(): Promise<CloudInfo> {
  try {
    return await api<CloudInfo>('/backup/meta')
  } catch {
    return api<CloudInfo>('/backup')
  }
}

export async function unlockAppCloud(): Promise<AppCloudState> {
  const info = await fetchAppCloudInfo()
  let localSessions = 0
  let merged = 0
  if (info.legacyKey) {
    // 旧密钥账号先用旧密钥解锁本地标题，否则读取摘要会抛出“尚未解锁”。
    setSessionKey(info.legacyKey)
    localSessions = (await loadSessionSummaries()).length
    await migrateAppEncryption()
    if (info.backup) {
      try {
        const remote = await readBackup(info)
        merged = await mergeSessions(fromWeb(remote))
      } catch {
        // 旧备份损坏时放弃。
      }
    }
    const oldSessions = await loadAllSessions()
    setSessionKey(info.key)
    for (const session of oldSessions) await saveSession(session)
    try {
      await pushAppCloud()
    } catch {
      // 网络差时下次再试。
    }
  } else {
    setSessionKey(info.key)
    localSessions = (await loadSessionSummaries()).length
    await migrateAppEncryption()
    if (info.backup) {
      try {
        const remote = await readBackup(info)
        merged = await mergeSessions(fromWeb(remote))
      } catch {
        // 损坏或旧格式备份不阻断登录。
      }
    }
  }
  return { key: info.key, backup: info.backup, merged, localSessions }
}

export async function pushAppCloud(): Promise<void> {
  if (!hasSessionKey()) return
  let tombstones: Array<{ id: string; deletedAt: number }> = []
  try {
    const info = await fetchAppCloudInfo()
    // 超大备份在低端 WebView 上加密/压缩会触发内存峰值，改为只拉取、不自动上传。
    if (info.backup && !info.legacyKey) {
      const remote = await readBackup(info)
      tombstones = remote.tombstones ?? []
      await mergeSessions(fromWeb(remote))
    }
  } catch {
    // 拉取失败不阻断本次上传。
  }
  const sessions = await loadAllSessions()
  const payload = await gzip(
    JSON.stringify({ ...toWeb(sessions), version: 2, tombstones }),
  )
  const encrypted = await encryptBytes(payload)
  const cipher = base64ToBytes(encrypted.data)
  if (cipher.byteLength > MAX_BACKUP_BYTES) {
    throw new Error(`云端备份加密后约 ${(cipher.byteLength / 1024 / 1024).toFixed(1)} MB，超过 20 MB 上限；请清理较早会话。`)
  }
  await api('/backup/stream', {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      'x-backup-iv': encrypted.iv,
      'x-backup-encoding': 'gzip',
    },
    body: cipher as unknown as BodyInit,
  })
  localStorage.setItem('dream-app-last-push', String(Date.now()))
}

export async function maybePushAppCloud(): Promise<void> {
  if (!hasSessionKey()) return
  if (localStorage.getItem('dream-app-upload-declined') === '1') return
  if (localStorage.getItem('dream-app-upload-pending') === '1') return
  const last = Number(localStorage.getItem('dream-app-last-push')) || 0
  if (Date.now() - last < 5 * 60 * 1000) return
  try {
    await pushAppCloud()
  } catch {
    // 网络差时下次再试。
  }
}
