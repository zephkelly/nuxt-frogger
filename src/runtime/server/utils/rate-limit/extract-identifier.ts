import { H3Event, getHeader, getRequestIP } from 'h3'
import type { RateLimitIdentifier } from '../../types/rate-limiter'


function extractClientIP(event: H3Event): string {
    let ip = getRequestIP(event, { xForwardedFor: true })
    
    if (ip) {
        ip = ip.split(',')[0].trim()
        if (isValidIP(ip)) {
            return ip
        }
    }

    // Manual header checking for common proxy scenarios
    const fallbackHeaders = [
        'cf-connecting-ip',      // Cloudflare
        'x-real-ip',             // Nginx
        'x-forwarded-for',       // Load balancers/proxies
        'x-client-ip',           // Some proxies
        'x-cluster-client-ip',   // Cluster setups
        'forwarded-for',         // Some older proxies
        'forwarded'              // RFC 7239
    ]

    for (const header of fallbackHeaders) {
        const headerValue = getHeader(event, header)
        if (headerValue) {
            ip = headerValue.split(',')[0].trim()
            if (ip && isValidIP(ip)) {
                return ip
            }
        }
    }

    return 'unknown'
}

function isValidIP(ip: string): boolean {
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/
    
    return ipv4Regex.test(ip) || ipv6Regex.test(ip)
}

export function extractRateLimitIdentifier(event: H3Event): RateLimitIdentifier {
    const ip = extractClientIP(event)
    const reporterId = getHeader(event, 'x-frogger-reporter-id')
    const appName = getHeader(event, 'x-frogger-source')

    return {
        ip: ip.toLowerCase().trim(),
        reporterId: reporterId || undefined,
        appName: appName || undefined
    }
}
