/**
 * Which outbound URLs may receive Frogger's trace headers.
 *
 * Defaults to SAME-ORIGIN ONLY, and that default is the whole safety property:
 * a naive global fetch patch attaches internal trace ids to every third-party
 * endpoint a page calls - analytics, ad networks, payment widgets - which
 * leaks internal topology to parties that have no business seeing it.
 *
 * `false` disables propagation entirely. An array is an allow-list of extra
 * destinations on top of same-origin.
 *
 * A RegExp matcher MUST be anchored. `/api\.example\.com/` matches
 * `https://evil.test/?x=api.example.com`; Datadog shipped exactly that bug.
 * Write `/^https:\/\/api\.example\.com\//` instead.
 */
export type TracePropagationOption =
    | false
    | {
        urls?: (string | RegExp | ((url: string) => boolean))[]
    }

/**
 * Whether `url` is same-origin with `origin`, treating a relative URL as
 * same-origin (it resolves against the page).
 */
export function isSameOrigin(url: string, origin: string): boolean {
    if (!url) return false

    // Relative, protocol-relative-to-self, or a bare path: same origin.
    if (url.startsWith('/') && !url.startsWith('//')) return true
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//')) return true

    try {
        return new URL(url, origin).origin === origin
    }
    catch {
        return false
    }
}

/**
 * Should this outbound request carry trace headers?
 *
 * Order matters: same-origin is always allowed, then the explicit allow-list.
 * A matcher that throws is treated as "no" - a broken predicate must not
 * become a leak.
 */
export function shouldPropagateTrace(
    url: string,
    origin: string,
    option: TracePropagationOption | undefined,
): boolean {
    if (option === false) return false

    if (isSameOrigin(url, origin)) return true

    const matchers = option?.urls
    if (!matchers?.length) return false

    const absolute = (() => {
        try {
            return new URL(url, origin).toString()
        }
        catch {
            return url
        }
    })()

    for (const matcher of matchers) {
        try {
            if (typeof matcher === 'string') {
                if (absolute.startsWith(matcher)) return true
            }
            else if (matcher instanceof RegExp) {
                if (matcher.test(absolute)) return true
            }
            else if (matcher(absolute)) {
                return true
            }
        }
        catch {
            // A throwing matcher is not an allow.
        }
    }

    return false
}

/** Extract a request URL from the many shapes ofetch accepts. */
export function urlOf(request: unknown): string {
    if (typeof request === 'string') return request
    if (request instanceof URL) return request.toString()
    if (request && typeof request === 'object' && 'url' in request) {
        return String((request as { url: unknown }).url ?? '')
    }
    return ''
}
