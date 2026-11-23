import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'cn.pum.dream',
  appName: 'Dream',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    errorPath: 'error.html',
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    // 安全区交给 CSS 的 env(safe-area-inset-*) / SystemBars 注入变量处理，
    // 避免 WKWebView 的 contentInset 与键盘 resize、页面固定布局互相叠加。
    contentInset: 'never',
  },
}

export default config
