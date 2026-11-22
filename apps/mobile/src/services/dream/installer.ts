import { Capacitor } from '@capacitor/core'

interface ApkInstallerPlugin {
  install(options: { url: string; sha256?: string }): Promise<{ ok: boolean }>
}

/**
 * 在原生 App 内下载 APK 并拉起系统安装器。
 * Web 端或插件不可用时返回 false，由调用方回退到浏览器下载。
 */
export async function installApk(url: string, sha256?: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  const plugin = (Capacitor as unknown as { Plugins?: { ApkInstaller?: ApkInstallerPlugin } }).Plugins?.ApkInstaller
  if (!plugin) return false
  await plugin.install({ url, sha256 })
  return true
}
