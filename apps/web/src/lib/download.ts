import { useEffect, useState } from "react";

const FALLBACK = "/download/dream-android.apk";

/** 下载地址以服务端 /api/v1/version 为准，发布新 APK 时无需再改前端。 */
export function useDownloadUrl(): string {
  const [url, setUrl] = useState(FALLBACK);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/version")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { apkUrl?: unknown } | null) => {
        if (!cancelled && payload && typeof payload.apkUrl === "string" && payload.apkUrl.startsWith("http")) {
          setUrl(payload.apkUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return url;
}
