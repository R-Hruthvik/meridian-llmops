import { readFileSync } from 'node:fs'
import { defineConfig, type ConfigEnv, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { InlineConfig } from 'vitest/node'
import { fileURLToPath } from 'node:url'

interface VitestConfigExport extends UserConfig {
  test?: InlineConfig
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

function readLocalProxyEnv(): Record<string, string> {
  try {
    const contents = readFileSync(`${projectRoot}/.env.local`, 'utf8')
    const values: Record<string, string> = {}
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^(API_KEYS|ADMIN_API_KEY)=(.*)$/)
      if (!match) continue
      let value = match[2]
      if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
      values[match[1]] = value
    }
    return values
  } catch {
    return {}
  }
}

// https://vitejs.dev/config/
export default (defineConfig as (
  config: (env: ConfigEnv) => VitestConfigExport,
) => (env: ConfigEnv) => VitestConfigExport)(({ mode }) => {
  // Read only the root local API-key entries for development proxy setup.
  // Never pass secrets through Vite's client-visible environment or `define`.
  const serverEnv = mode === 'development'
    ? { ...readLocalProxyEnv(), ...process.env }
    : process.env
  let proxyApiKey = serverEnv.ADMIN_API_KEY || ''
  if (!proxyApiKey && serverEnv.API_KEYS) {
    const configuredKeys = JSON.parse(serverEnv.API_KEYS) as Record<string, { role?: string }>
    proxyApiKey = Object.keys(configuredKeys).find((key) => configuredKeys[key]?.role === 'admin')
      || Object.keys(configuredKeys)[0]
      || ''
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/v1': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          configure: (proxy) => {
            if (proxyApiKey) {
              proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('X-API-Key', proxyApiKey))
            }
          },
        },
        '/health': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/setupTests.ts'],
      css: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: [
          'node_modules/',
          'dist/',
          '**/*.d.ts',
          'src/main.tsx',
          'src/setupTests.ts',
          '**/*.config.{ts,js}',
        ],
      },
    },
  } satisfies VitestConfigExport
})
