/** Dream 账号：与服务端 /api/v1/auth 交互，token 存 localStorage。 */

export type DreamUser = {
  id: string
  username: string
  displayName: string | null
  createdAt: string
  isAdmin?: boolean
}

export type DreamSession = {
  token: string
  user: DreamUser
}

const TOKEN_KEY = 'dream:token'
const USER_KEY = 'dream:user'

export const apiBase = (): string => `${__API_ORIGIN__}/api/v1`

const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeStorage = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // 存储不可用时只保留内存状态
  }
}

let memoryToken: string | null = null
let memoryUser: DreamUser | null = null

export const getToken = (): string | null => memoryToken ?? readStorage(TOKEN_KEY)

export const getUser = (): DreamUser | null => {
  if (memoryUser) return memoryUser
  const raw = readStorage(USER_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as DreamUser
    return parsed && typeof parsed.username === 'string' ? parsed : null
  } catch {
    return null
  }
}

export const setSession = (session: DreamSession) => {
  memoryToken = session.token
  memoryUser = session.user
  writeStorage(TOKEN_KEY, session.token)
  writeStorage(USER_KEY, JSON.stringify(session.user))
}

export const clearSession = () => {
  memoryToken = null
  memoryUser = null
  writeStorage(TOKEN_KEY, null)
  writeStorage(USER_KEY, null)
}

export class AuthError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

const postJson = async (path: string, body: unknown): Promise<DreamSession> => {
  let response: Response
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new AuthError(
      `无法连接 Dream 服务器：${error instanceof Error ? error.message : String(error)}`,
      0,
    )
  }
  const payload = (await response.json().catch(() => null)) as
    | { token?: string; user?: DreamUser; error?: { message?: string } }
    | null
  if (!response.ok || !payload?.token || !payload.user) {
    throw new AuthError(payload?.error?.message ?? '登录失败，请稍后重试', response.status)
  }
  return { token: payload.token, user: payload.user }
}

export const login = (username: string, password: string): Promise<DreamSession> =>
  postJson('/auth/login', { username, password })

export const register = (username: string, password: string): Promise<DreamSession> =>
  postJson('/auth/register', { username, password })

export const fetchMe = async (token: string): Promise<DreamUser> => {
  const response = await fetch(`${apiBase()}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new AuthError('登录已失效，请重新登录', response.status)
  }
  const payload = (await response.json()) as { user: DreamUser }
  return payload.user
}

export const logout = async (): Promise<void> => {
  const token = getToken()
  clearSession()
  if (!token) return
  try {
    await fetch(`${apiBase()}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    // 退出登录不因网络失败阻断本地清理
  }
}
