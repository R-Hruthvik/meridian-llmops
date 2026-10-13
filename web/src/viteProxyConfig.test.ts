// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import viteConfig from '../vite.config'

type ViteConfigFactory = (env: { mode: string }) => {
  server?: { proxy?: Record<string, { target?: string }> }
}

const originalProxyTarget = process.env.VITE_API_PROXY_TARGET

afterEach(() => {
  if (originalProxyTarget === undefined) delete process.env.VITE_API_PROXY_TARGET
  else process.env.VITE_API_PROXY_TARGET = originalProxyTarget
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
})
