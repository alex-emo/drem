import { apiBase } from './auth.js'

export interface ServerVersion {
  version: string
  apkUrl: string
  notes?: string
  publishedAt?: string
}

export const APP_VERSION = __APP_VERSION__

const parse = (version: string): number[] =>
  version
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)

/** 语义化版本比较：a>b 返回 1，a<b 返回 -1。 */
export const compareVersion = (a: string, b: string): number => {
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

export async function fetchServerVersion(): Promise<ServerVersion | null> {
  try {
    const response = await fetch(`${apiBase()}/version`)
    if (!response.ok) return null
    return (await response.json()) as ServerVersion
  } catch {
    return null
  }
}
