import { H3Event, getHeader, getRequestIP } from 'h3'
import type { RateLimitIdentifier, TrustProxyOption } from '../types'

/**
 * Forwarding headers, in the order they are consulted once forwarding is
 * trusted. Every one of these is attacker-supplied on an untrusted hop.
 */
const FORWARDING_HEADERS = [
    'cf-connecting-ip',      // Cloudflare
    'x-real-ip',             // Nginx
    'x-forwarded-for',       // Load balancers / proxies
    'x-client-ip',
    'x-cluster-client-ip',
    'forwarded-for',
    'forwarded',             // RFC 7239
] as const

/**
 * Resolve the client address to rate-limit on.
 *
 * `trustProxy` defaults to `false`, which means the socket peer address and
 * nothing else. This is the load-bearing default: with forwarding headers
 * trusted unconditionally, an attacker rotating `x-real-ip` gets a fresh
 * bucket per request (no limit at all), and one spoofing a victim's address
 * drives that address into the escalating block list for hours.
 *
 * `true` or a hop count trusts `x-forwarded-for`, taking the Nth address from
 * the right so intermediate proxies you actually control are skipped. An array
 * is a list of trusted peer addresses: forwarding headers are honoured only
 * when the immediate peer is one of them.
 */
export function extractClientIP(event: H3Event, trustProxy: TrustProxyOption = false): string {
    const peer = normalizeIp(getRequestIP(event))

    if (!trustProxy) {
        return peer ?? 'unknown'
    }

    if (Array.isArray(trustProxy)) {
        if (!peer || !trustProxy.includes(peer)) {
            return peer ?? 'unknown'
        }
        return forwardedIp(event, 1) ?? peer
    }

    const hops = typeof trustProxy === 'number' ? trustProxy : 1
    return forwardedIp(event, hops) ?? peer ?? 'unknown'
}

/**
 * The address `hops` positions from the RIGHT of `x-forwarded-for`, falling
 * back to the single-value forwarding headers.
 *
 * Counting from the right is the whole point: the leftmost entry is whatever
 * the original client claimed and is freely forgeable, while the rightmost
 * entries were appended by proxies. With one trusted hop, the last entry is
 * the address that proxy observed.
 */
function forwardedIp(event: H3Event, hops: number): string | undefined {
    const forwardedFor = getHeader(event, 'x-forwarded-for')
    if (forwardedFor) {
        const chain = forwardedFor.split(',').map(part => normalizeIp(part)).filter(Boolean) as string[]
        const candidate = chain[chain.length - hops]
        if (candidate) return candidate
    }

    for (const header of FORWARDING_HEADERS) {
        const value = getHeader(event, header)
        if (!value) continue

        const candidate = normalizeIp(value.split(',')[0])
        if (candidate) return candidate
    }

    return undefined
}

function normalizeIp(value: string | undefined | null): string | undefined {
    if (!value) return undefined
    const trimmed = value.trim().toLowerCase()
    return isValidIP(trimmed) ? trimmed : undefined
}

export function isValidIP(ip: string): boolean {
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
    // Loose but bounded: covers full and compressed forms without trying to be
    // a full RFC 4291 parser, and rejects anything with non-hex characters.
    const ipv6Regex = /^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/

    return ipv4Regex.test(ip) || (ip.includes(':') && ipv6Regex.test(ip))
}

/**
 * Build the rate-limit key set for a request.
 *
 * `reporterId` and `appName` come from `x-frogger-reporter-id` /
 * `x-frogger-source`, both attacker-supplied: every unique value mints a fresh
 * unstorage key, so an attacker rotating them gets an unbounded number of
 * buckets and never hits a limit. They are only honoured when the request is
 * authenticated (an API key was presented), and they are length-capped either
 * way so one header cannot become an unbounded KV key.
 *
 * Note these tiers are also inert for browser traffic: the client queue's
 * primary POST sends neither header, so only `ip` and `global` can ever engage
 * there.
 */
export function extractRateLimitIdentifier(
    event: H3Event,
    trustProxy: TrustProxyOption = false,
): RateLimitIdentifier {
    const ip = extractClientIP(event, trustProxy)
    const authenticated = Boolean(getHeader(event, 'x-api-key'))

    return {
        ip: ip.toLowerCase().trim(),
        reporterId: authenticated ? boundedKey(getHeader(event, 'x-frogger-reporter-id')) : undefined,
        appName: authenticated ? boundedKey(getHeader(event, 'x-frogger-source')) : undefined,
    }
}

/** Cap a header-derived key so it cannot become an unbounded storage key. */
function boundedKey(value: string | undefined): string | undefined {
    if (!value) return undefined
    const trimmed = value.trim()
    if (trimmed.length === 0) return undefined
    return trimmed.slice(0, 128)
}
