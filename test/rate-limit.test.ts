import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('Sliding Window Rate Limiter', async () => {
    await setup({
        rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
        nuxtConfig: {
        runtimeConfig: {
            frogger: {
                //@ts-ignore
            rateLimiter: {
                limits: {
                    global: 100,
                    perIp: 5, // Low limit for testing
                    perReporter: 10,
                    perApp: 20
                },
                windows: {
                    global: 60,
                    perIp: 60, // 1 minute window
                    perReporter: 60,
                    perApp: 60
                },
                blocking: {
                    enabled: true,
                    escalationResetHours: 1,
                    timeouts: [60, 300, 1800] // 1min, 5min, 30min
                }
            }
            }
        }
        }
    })

    describe('ssr', async () => {
    await setup({
        rootDir: fileURLToPath(new URL('./fixtures/rate-limit', import.meta.url)),
    })

    it('renders the index page', async () => {
        // Get response to a server-rendered page with `$fetch`.
        const html = await $fetch('/')
        expect(html).toContain('<div>basic</div>')
    })
    })
})
