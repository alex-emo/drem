import { saveSession, loadSessionSummaries, loadAllSessions } from '../chat/db.js'
import { decryptBytes, encryptBytes, hasSessionKey } from './crypto.js'
import { fromWeb, toWeb, type BackupData } from './cloud.js'
import type { Session } from '../chat/types.js'

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return bytes
  const blob = await new Response(new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
  return new Uint8Array(await blob.arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') return bytes
  const blob = await new Response(new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).blob()
  return new Uint8Array(await blob.arrayBuffer())
}

export async function exportDreamBackup(): Promise<{ name: string; blob: Blob }> {
  if (!hasSessionKey()) throw new Error('请先登录并解锁聊天记录，再导出备份。')
  const sessions = await loadAllSessions()
  const payload = toWeb(sessions)
  const canCompress = typeof CompressionStream !== 'undefined'
  const compressed = canCompress
    ? await gzip(new TextEncoder().encode(JSON.stringify(payload)))
    : new TextEncoder().encode(JSON.stringify(payload))
  const encrypted = await encryptBytes(compressed)
  const envelope = {
    format: 'dream-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    encrypted: true,
    algorithm: 'AES-GCM',
    ...(canCompress ? { compression: 'gzip' as const } : {}),
    iv: encrypted.iv,
    data: encrypted.data,
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  const name = `dream-export-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.dream`
  return { name, blob: new Blob([JSON.stringify(envelope)], { type: 'application/json' }) }
}

export async function importDreamBackup(file: File): Promise<number> {
  const parsed = JSON.parse(await file.text()) as {
    format?: string
    encrypted?: boolean
    iv?: string
    data?: string
    compression?: string
    sessions?: Session[]
    conversations?: unknown[]
    messages?: unknown[]
  }
  let data: BackupData
  if (parsed.format === 'dream-export') {
    if (parsed.encrypted) {
      if (!parsed.iv || !parsed.data) throw new Error('加密备份缺少必要字段。')
      if (!hasSessionKey()) throw new Error('这是加密备份，请先登录后导入。')
      const decrypted = await decryptBytes(parsed.iv, parsed.data)
      const plain = parsed.compression === 'gzip' ? await gunzip(decrypted) : decrypted
      data = JSON.parse(new TextDecoder().decode(plain)) as BackupData
    } else {
      data = parsed as unknown as BackupData
    }
  } else if (parsed.format === 'dream-backup') {
    data = parsed as unknown as BackupData
  } else {
    throw new Error('这不是 Dream 的备份文件。')
  }
  const incoming = data.sessions?.length ? data.sessions : fromWeb(data)
  const local = new Map((await loadSessionSummaries()).map((session) => [session.id, session]))
  let count = 0
  for (const session of incoming) {
    const existing = local.get(session.id)
    if (existing && existing.updatedAt >= session.updatedAt) continue
    await saveSession(session)
    count += 1
  }
  return count
}
