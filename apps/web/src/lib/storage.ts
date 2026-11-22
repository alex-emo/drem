export interface StorageInfo {
  supported: boolean;
  persisted: boolean;
  usage: number;
  quota: number;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export async function readStorageInfo(): Promise<StorageInfo> {
  const supported = typeof navigator !== "undefined" && Boolean(navigator.storage);
  let persisted = false;
  let usage = 0;
  let quota = 0;
  try {
    if (supported) {
      persisted = (await navigator.storage.persisted?.()) ?? false;
      const estimate = await navigator.storage.estimate();
      usage = estimate.usage ?? 0;
      quota = estimate.quota ?? 0;
    }
  } catch {
    // 某些浏览器会拒绝 estimate，保留默认值
  }
  return { supported, persisted, usage, quota };
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
