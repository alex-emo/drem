import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { decryptJson, decryptText, encryptJson, encryptText, hasSessionKey } from '../dream/crypto.js'
import { toSessionSummary, type Session, type SessionSummary } from './types.js'

/** IndexedDB 存储结构版本；新增或调整存储、索引时递增。 */
const DB_VERSION = 11

/** 文件原件按附件的本地 id 存储，所有引用同一 id 的消息共用一份；用于缩略图、打开查看，以及没有 serverId 时补传。 */
export type StoredFile = {
  id: string
  blob: Blob
}

/** 文件引用留在摘要中，删除会话时通过索引判断原件是否仍被引用。 */
type StoredSessionSummary = SessionSummary & { fileIds: string[] }

interface ChatDB extends DBSchema {
  /** 当前使用的会话，界面读写都在这里 */
  sessions: { key: string; value: Session }
  sessionSummaries: {
    key: string
    value: StoredSessionSummary
    indexes: { fileIds: string }
  }
  /** 当前使用的文件原件 */
  files: { key: string; value: StoredFile }
  /**
   * 历史导入的暂存：导入过程中会话与原件只写入这两个存储，`sessions` / `files` 保持不变；
   * 全部校验通过后在一个事务中替换正式数据并清空暂存，失败时只清空暂存。
   */
  sessionsStaging: { key: string; value: Session }
  filesStaging: { key: string; value: StoredFile }
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null

const storedSummary = (session: Session): StoredSessionSummary => ({
  ...toSessionSummary(session),
  fileIds: [
    ...new Set(
      session.messages.flatMap((message) =>
        message.role === 'user' ? message.files.map((file) => file.id) : []
      )
    ),
  ],
})

const abortTransaction = (tx: { abort(): void }) => {
  try {
    tx.abort()
  } catch {
    // 事务已因请求失败中止。
  }
}

// 每个操作拿到连接后立即创建事务；IndexedDB 按创建顺序执行范围重叠的事务，读取总能看到之前发起的写入。
const getDB = () =>
  (dbPromise ??= openDB<ChatDB>('chat-demo', DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, tx) {
      // 初始化当前格式需要的存储与索引，不迁移旧消息。
      for (const name of ['sessions', 'files', 'sessionsStaging', 'filesStaging'] as const) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      }
      const summaries = db.objectStoreNames.contains('sessionSummaries')
        ? tx.objectStore('sessionSummaries')
        : db.createObjectStore('sessionSummaries', { keyPath: 'id' })
      if (!summaries.indexNames.contains('fileIds')) {
        summaries.createIndex('fileIds', 'fileIds', { multiEntry: true })
      }
    },
  }).catch((error: unknown) => {
    // 打开失败后允许界面重试，避免一直复用已拒绝的 Promise。
    dbPromise = null
    throw error
  }))

const encryptSessionRecord = async (session: Session): Promise<Session> => {
  if (!hasSessionKey()) return session
  return { ...session, title: '', messages: [], enc: await encryptJson(session) }
}

const decryptSessionRecord = async (record: Session): Promise<Session> => {
  if (!record.enc) return record
  const session = await decryptJson<Session>(record.enc)
  return { ...session, enc: undefined }
}

const encryptSummaryRecord = async (session: Session): Promise<StoredSessionSummary> => {
  const summary = storedSummary(session)
  if (!hasSessionKey()) return summary
  return { ...summary, title: '', encTitle: await encryptText(session.title) }
}

export const migrateAppEncryption = async (): Promise<void> => {
  if (!hasSessionKey()) return
  const db = await getDB()
  const sessions = await db.getAll('sessions')
  const summaries = await db.getAll('sessionSummaries')
  const needSessions = sessions.filter((session) => !session.enc)
  const needSummaries = summaries.filter((summary) => !summary.encTitle)
  if (!needSessions.length && !needSummaries.length) return
  const encryptedSessions = await Promise.all(needSessions.map(encryptSessionRecord))
  const encryptedSummaries = await Promise.all(
    needSummaries.map(async (summary) => ({
      ...summary,
      encTitle: await encryptText(summary.title),
      title: '',
    })),
  )
  const tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    ...encryptedSessions.map((session) => tx.objectStore('sessions').put(session)),
    ...encryptedSummaries.map((summary) => tx.objectStore('sessionSummaries').put(summary)),
    tx.done,
  ])
}

export const loadSessionSummaries = async (): Promise<SessionSummary[]> => {
  const rows = await (await getDB()).getAll('sessionSummaries')
  return Promise.all(
    rows.map(async (row) => {
      const summary = toSessionSummary(row)
      if (!row.encTitle) return summary
      return { ...summary, title: await decryptText(row.encTitle) }
    }),
  )
}

export const loadAllSessions = async (): Promise<Session[]> => {
  const summaries = await loadSessionSummaries()
  const sessions: Session[] = []
  for (const summary of summaries) {
    const session = await loadSession(summary.id)
    if (session) sessions.push(session)
  }
  return sessions
}

export const loadSession = async (id: string): Promise<Session | undefined> => {
  const record = await (await getDB()).get('sessions', id)
  return record ? decryptSessionRecord(record) : undefined
}

export const saveSession = async (session: Session, files: StoredFile[] = []): Promise<void> => {
  const summary = await encryptSummaryRecord(session)
  const stored = await encryptSessionRecord(session)
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        for (const file of files) {
          await tx.objectStore('files').put(file)
        }
        await tx.objectStore('sessions').put(stored)
        await tx.objectStore('sessionSummaries').put(summary)
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
  try {
    window.dispatchEvent(new CustomEvent('dream-app-backup-dirty'))
  } catch {
    // 不影响会话保存。
  }
}

/** 未打开的会话也可重命名；读取→解密→改标题→重新加密写入。 */
export const renameSession = async (id: string, title: string): Promise<void> => {
  const session = await loadSession(id)
  if (!session) return
  await saveSession({ ...session, title, updatedAt: Date.now() })
}

/** 删除会话，仅清理已无会话引用的本地原件；远端文件不删。 */
export const deleteSession = async (sessionId: string): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const summaries = tx.objectStore('sessionSummaries')
        const summary = await summaries.get(sessionId)
        await tx.objectStore('sessions').delete(sessionId)
        await summaries.delete(sessionId)
        for (const id of summary?.fileIds ?? []) {
          if ((await summaries.index('fileIds').count(id)) === 0) {
            await tx.objectStore('files').delete(id)
          }
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

const putFiles = async (store: 'files' | 'filesStaging', files: StoredFile[]) => {
  const tx = (await getDB()).transaction(store, 'readwrite')
  await Promise.all([...files.map((file) => tx.store.put(file)), tx.done])
}

export const saveFiles = (files: StoredFile[]): Promise<void> => putFiles('files', files)

export const loadFile = async (id: string): Promise<Blob | undefined> =>
  (await (await getDB()).get('files', id))?.blob

/** 清空导入暂存：开始导入前清除上次中断（如关闭页面）遗留的数据，导入失败后清除本次写入。 */
export const clearStaging = async (): Promise<void> => {
  const tx = (await getDB()).transaction(['sessionsStaging', 'filesStaging'], 'readwrite')
  await Promise.all([
    tx.objectStore('sessionsStaging').clear(),
    tx.objectStore('filesStaging').clear(),
    tx.done,
  ])
}

export const addStagingSession = async (session: Session): Promise<void> => {
  await (await getDB()).add('sessionsStaging', session)
}

export const saveStagingFiles = (files: StoredFile[]): Promise<void> =>
  putFiles('filesStaging', files)

/** 图片位于会话 JSON 之后；全部读完后回填具体 MIME，保留归档给出的 isImage 标识。 */
export const updateStagingFileTypes = async (types: ReadonlyMap<string, string>): Promise<void> => {
  const tx = (await getDB()).transaction('sessionsStaging', 'readwrite')
  await Promise.all([
    (async () => {
      for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue()) {
        const session = cursor.value
        let changed = false
        for (const message of session.messages) {
          if (message.role !== 'user') {
            continue
          }
          for (const file of message.files) {
            const type = types.get(file.id) ?? ''
            if (file.mimeType !== type) {
              file.mimeType = type
              changed = true
            }
          }
        }
        if (changed) {
          await cursor.update(session)
        }
      }
    })(),
    tx.done,
  ])
}

/**
 * 导入完成后用暂存替换正式数据：同一事务中替换会话、摘要和原件，并清空暂存。
 * 逐条游标复制，同一时间只读取一条记录；事务失败时整体回滚，正式数据不变。
 */
export const commitStaging = async (): Promise<SessionSummary[]> => {
  const db = await getDB()
  const stagingSessions = await db.getAll('sessionsStaging')
  const encryptedSessions = await Promise.all(stagingSessions.map(encryptSessionRecord))
  const encryptedSummaries = await Promise.all(stagingSessions.map(encryptSummaryRecord))
  const summaries = stagingSessions.map(toSessionSummary)
  const tx = db.transaction(
    ['sessions', 'sessionSummaries', 'files', 'sessionsStaging', 'filesStaging'],
    'readwrite'
  )
  await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const summariesStore = tx.objectStore('sessionSummaries')
        await sessions.clear()
        await summariesStore.clear()
        for (const session of encryptedSessions) await sessions.put(session)
        for (const summary of encryptedSummaries) await summariesStore.put(summary)
        const files = tx.objectStore('files')
        await files.clear()
        for (let cursor = await tx.objectStore('filesStaging').openCursor(); cursor; cursor = await cursor.continue()) {
          await files.put(cursor.value)
        }
        await tx.objectStore('sessionsStaging').clear()
        await tx.objectStore('filesStaging').clear()
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
  return summaries
}

/** 本地存储失败不打断对话，只在控制台留痕 */
export const reportStorageError = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[storage] ${action} failed`, error)
}
