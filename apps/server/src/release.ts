import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";

export interface ReleaseInfo {
  version: string;
  versionCode: number;
  sha256: string;
  size: number;
  apkUrl: string;
  notes: string;
  publishedAt: string;
}

interface HashCache {
  mtimeMs: number;
  size: number;
  sha256: string;
}

let hashCache: HashCache | null = null;

function apkPath(): string {
  return resolve(config.downloadDir, "dream-android.apk");
}

async function apkSha256(): Promise<{ sha256: string; size: number } | null> {
  const path = apkPath();
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return null;
  }
  if (hashCache && hashCache.mtimeMs === stat.mtimeMs && hashCache.size === stat.size) {
    return { sha256: hashCache.sha256, size: hashCache.size };
  }
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolvePromise());
    stream.on("error", reject);
  });
  const sha256 = hash.digest("hex");
  hashCache = { mtimeMs: stat.mtimeMs, size: stat.size, sha256 };
  return { sha256, size: stat.size };
}

export async function getRelease(baseUrl: string): Promise<ReleaseInfo | null> {
  const apk = await apkSha256();
  if (!apk) return null;
  return {
    version: config.appVersion,
    versionCode: config.appVersionCode,
    sha256: apk.sha256,
    size: apk.size,
    apkUrl: `${baseUrl}/download/dream-android.apk?v=${config.appVersion}&h=${apk.sha256.slice(0, 12)}&t=${Date.now()}`,
    notes: "发布通道：版本、版本号与安装包 SHA-256 校验。",
    publishedAt: new Date().toISOString(),
  };
}
