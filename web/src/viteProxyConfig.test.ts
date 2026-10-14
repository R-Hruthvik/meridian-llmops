// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import viteConfig from '../vite.config'

type ViteConfigFactory = (env: { mode: string }) => {
  server?: { proxy?: Record<string, { target?: string; configure?: (proxy: { on: (event: string, listener: (request: { setHeader: (name: string, value: string) => void }) => void) => void }) => void }> }
}

const originalProxyTarget = process.env.VITE_API_PROXY_TARGET
const originalAdminKey = process.env.ADMIN_API_KEY

afterEach(() => {
  if (originalProxyTarget === undefined) delete process.env.VITE_API_PROXY_TARGET
  else process.env.VITE_API_PROXY_TARGET = originalProxyTarget
  if (originalAdminKey === undefined) delete process.env.ADMIN_API_KEY
  else process.env.ADMIN_API_KEY = originalAdminKey
})

describe('Vite development proxy', () => {
  it('defaults API and health routes to the local API server', () => {
    delete process.env.VITE_API_PROXY_TARGET
    const config = (viteConfig as unknown as ViteConfigFactory)({ mode: 'test' })

    expect(config.server?.proxy?.['/v1'].target).toBe('http://localhost:8000')
    expect(config.server?.proxy?.['/health'].target).toBe('http://localhost:8000')
  })

  it('uses VITE_API_PROXY_TARGET for API and health routes', () => {
    process.env.VITE_API_PROXY_TARGET = 'http://api.internal:9000'
    const config = (viteConfig as unknown as ViteConfigFactory)({ mode: 'test' })

    expect(config.server?.proxy?.['/v1'].target).toBe('http://api.internal:9000')
    expect(config.server?.proxy?.['/health'].target).toBe('http://api.internal:9000')
  })

  it('keeps local access keys in the shared env-backed server proxy', () => {
    process.env.ADMIN_API_KEY = 'test-admin-key'
    const config = (viteConfig as unknown as ViteConfigFactory)({ mode: 'development' })
    let proxyRequest: ((request: { setHeader: (name: string, value: string) => void }) => void) | undefined
    const proxy = config.server?.proxy?.['/v1']
    proxy?.configure?.({ on: (_event, listener) => { proxyRequest = listener } })
    const setHeader = vi.fn()
    proxyRequest?.({ setHeader })

    expect(setHeader).toHaveBeenCalledWith('X-API-Key', 'test-admin-key')
  })
})
