import { apiBase } from './auth.js'

export interface AppAnnouncement {
  id: number
  title: string
  body: string
  updatedAt: string
}

const SEEN_KEY = 'dream:announcement-seen'

export async function fetchLatestAnnouncement(): Promise<AppAnnouncement | null> {
  try {
    const response = await fetch(`${apiBase()}/announcement`, { cache: 'no-store' })
    if (!response.ok) return null
    const data = (await response.json()) as { announcement?: AppAnnouncement | null }
    return data.announcement ?? null
  } catch {
    return null
  }
}

export function isAnnouncementSeen(announcement: AppAnnouncement): boolean {
  return localStorage.getItem(SEEN_KEY) === `${announcement.id}:${announcement.updatedAt}`
}

export function markAnnouncementSeen(announcement: AppAnnouncement): void {
  localStorage.setItem(SEEN_KEY, `${announcement.id}:${announcement.updatedAt}`)
}
