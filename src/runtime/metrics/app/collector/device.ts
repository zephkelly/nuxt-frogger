import type { MetricContext } from '../../shared/types/metric-batch'

/**
 * Read a device/network/viewport envelope once, feature-detected. Every field
 * is best-effort: an unsupported API resolves to `null` (never `0`, which would
 * read as a genuine measurement). Safari and Firefox expose far fewer of these
 * than Chromium, so undercounts are expected - documented as a known caveat.
 *
 * The result is the client half of {@link MetricContext}; `ua` is stamped
 * server-side at ingest.
 */
export function collectDeviceContext(): MetricContext {
    const ctx: MetricContext = {}

    if (typeof navigator === 'undefined') return ctx

    const nav = navigator as unknown as {
        connection?: { effectiveType?: string }
        deviceMemory?: number
        hardwareConcurrency?: number
        userAgentData?: {
            brands?: { brand: string; version: string }[]
            platform?: string
            mobile?: boolean
        }
    }

    ctx.effectiveType = nav.connection?.effectiveType ?? null
    ctx.deviceMemory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null
    ctx.hardwareConcurrency = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null

    const uaData = nav.userAgentData
    if (uaData) {
        const realBrand = uaData.brands?.find(b => !/not.a.brand/i.test(b.brand))
        if (realBrand) ctx.browser = realBrand.brand
        if (uaData.platform) ctx.os = uaData.platform
        if (typeof uaData.mobile === 'boolean') ctx.deviceType = uaData.mobile ? 'mobile' : 'desktop'
    }

    if (typeof window !== 'undefined') {
        ctx.viewport = { w: window.innerWidth, h: window.innerHeight }
    }

    return ctx
}
