import { backupSignature, downloadBackup } from "./backup";

const ENABLED_KEY = "dream-auto-backup";
const CONSENT_KEY = "dream-backup-consent";
const LAST_AT_KEY = "dream-backup-last-at";
const LAST_SIG_KEY = "dream-backup-last-sig";

export function autoBackupEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAutoBackupEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
}

export function autoBackupConsented(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function consentAutoBackup(): void {
  localStorage.setItem(CONSENT_KEY, "1");
}

export function lastBackupAt(): number {
  return Number(localStorage.getItem(LAST_AT_KEY)) || 0;
}

export async function backupNow(): Promise<void> {
  await downloadBackup();
  const now = Date.now();
  localStorage.setItem(LAST_AT_KEY, String(now));
  localStorage.setItem(LAST_SIG_KEY, backupSignature());
}

export function shouldAutoBackup(): boolean {
  if (!autoBackupEnabled() || !autoBackupConsented()) return false;
  if (backupSignature() === (localStorage.getItem(LAST_SIG_KEY) ?? "")) return false;
  return Date.now() - lastBackupAt() >= 10 * 60 * 1000;
}

/** 每分钟检查一次；真正备份最多每 10 分钟一次，且没有新数据时不会重复导出。 */
export function startAutoBackup(): () => void {
  const timer = window.setInterval(() => {
    if (!shouldAutoBackup()) return;
    void backupNow().catch(() => undefined);
  }, 60 * 1000);
  return () => window.clearInterval(timer);
}
