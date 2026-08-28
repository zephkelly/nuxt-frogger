import { type H3Event, getHeader, getRequestIP, getRequestWebStream, readRawBody, createError } from 'h3'

/**
 * Read a request body as a string, refusing to buffer more than `maxBytes`.
 *
 * A `content-length` pre-check alone is bypassable: a chunked POST carries no
 * such header, so the guard is skipped and the whole body is buffered anyway.
 * This counts bytes as they arrive and aborts the moment the cap is crossed.
 *
 * Reads the raw body rather than h3's `readBody` because page-exit batches
 * arrive via `navigator.sendBeacon`, whose `text/plain;charset=UTF-8`
 * content-type stops `readBody` from JSON-parsing at all.
 */
export async function readBoundedRawBody(event: H3Event, maxBytes: number): Promise<string> {
    const declared = getHeader(event, 'content-length')
    if (declared && Number.parseInt(declared, 10) > maxBytes) {
        throw tooLarge(maxBytes)
    }

    // Not every Nitro preset (or test double) exposes a request stream; treat
    // an unavailable one as "fall back", never as a failed request.
    let stream: ReadableStream<Uint8Array> | undefined
    try {
        stream = getRequestWebStream(event)
    }
    catch {
        stream = undefined
    }

    if (!stream) {
        // No stream available on this preset: fall back to the buffered read,
        // then enforce the cap on what arrived.
        const raw = await readRawBody(event, 'utf8')
        if (typeof raw !== 'string') return ''
        if (byteLength(raw) > maxBytes) throw tooLarge(maxBytes)
        return raw
    }

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let received = 0
    let body = ''

    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value) continue

            received += value.byteLength
            if (received > maxBytes) {
                await reader.cancel().catch(() => {})
                throw tooLarge(maxBytes)
            }

            body += decoder.decode(value, { stream: true })
        }
    }
    finally {
        reader.releaseLock?.()
    }

    return body + decoder.decode()
}

function byteLength(value: string): number {
    return typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(value).byteLength
        : value.length
}

function tooLarge(maxBytes: number) {
    return createError({
        statusCode: 413,
        statusMessage: 'Request Too Large',
        data: { error: 'REQUEST_TOO_LARGE', maxSize: maxBytes },
    })
}

/**
 * Peer address for the `meta.received.ip` stamp. Never throws: a preset that
 * cannot resolve one must not turn a valid batch into a 500.
 */
export function safeRequestIp(event: H3Event): string | undefined {
    try {
        return getRequestIP(event) || undefined
    }
    catch {
        return undefined
    }
}
