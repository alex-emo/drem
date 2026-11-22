interface FileSystemFileHandleLike {
  name: string;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
}

interface FilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandleLike>;
}

const DB_NAME = "dream-files";
const STORE = "handles";
const HANDLE_KEY = "backup-file";

function openHandleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getHandle(): Promise<FileSystemFileHandleLike | null> {
  try {
    const db = await openHandleDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(HANDLE_KEY);
      request.onsuccess = () => resolve((request.result as FileSystemFileHandleLike | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setHandle(handle: FileSystemFileHandleLike): Promise<void> {
  const db = await openHandleDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function supportsBackupFile(): boolean {
  return typeof (window as FilePickerWindow).showSaveFilePicker === "function";
}

/** 让用户选一次备份文件；之后自动备份会静默写入这个文件。 */
export async function chooseBackupFile(name: string): Promise<boolean> {
  const picker = (window as FilePickerWindow).showSaveFilePicker;
  if (!picker) return false;
  try {
    const handle = await picker({
      suggestedName: name,
      types: [{ description: "Dream 备份", accept: { "application/gzip": [".json.gz"], "application/json": [".json"] } }],
    });
    await setHandle(handle);
    return true;
  } catch {
    return false;
  }
}

export async function backupHandleName(): Promise<string | null> {
  return (await getHandle())?.name ?? null;
}

/** 优先写入用户选定的文件；否则触发浏览器下载。 */
export async function writeBackupBlob(blob: Blob, filename: string): Promise<"file" | "download"> {
  const handle = await getHandle();
  if (handle) {
    try {
      const permission = await handle.queryPermission?.({ mode: "readwrite" });
      const granted = permission === "granted" || (await handle.requestPermission?.({ mode: "readwrite" })) === "granted";
      if (granted) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return "file";
      }
    } catch {
      // 写入失败（文件被删/权限失效）时退回下载
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "download";
}
