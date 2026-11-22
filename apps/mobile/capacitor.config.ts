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
    contentInset: 'always',
  },
}

export default config
