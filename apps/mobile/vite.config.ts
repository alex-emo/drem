import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** 源码内部一律用 ESM 的 .js 说明符；映射到实际的 .ts/.tsx 文件。 */
const jsToTs = () => ({
  name: 'dream-js-to-ts',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (!source.startsWith('.') || !source.endsWith('.js')) return null
    const base = resolve(importer ? resolve(importer, '..') : process.cwd(), source)
    const stem = base.slice(0, -3)
    for (const ext of ['.ts', '.tsx']) {
      if (existsSync(stem + ext)) return stem + ext
    }
    return null
  },
})

export default defineConfig({
  plugins: [jsToTs(), react()],
  define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? pkg.version),
    __API_ORIGIN__: JSON.stringify(process.env.DREAM_API_ORIGIN ?? 'https://dream.pum.org.cn'),
  },
  server: { port: 8090, host: true },
  preview: { port: 8091 },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
})
