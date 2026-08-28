import type { LoggerObjectBatch } from '../types/batch'

export interface SplitBatchCaps {
    /** Max log events per chunk. Unset/0 = no count cap. */
    maxEvents?: number
    /** Max serialized body bytes per chunk. Unset/0 = no byte cap. */
    maxBytes?: number
}

/**
 * Split a log batch into chunks that respect a destination's per-batch caps
 * (nuxt-observe: 500 events, ~1 MiB body). Count is applied first, then a
 * greedy byte accumulation over `JSON.stringify(log).length` against `maxBytes`
 * minus an envelope allowance for the `app`/`meta` wrapper.
 *
 * Every chunk keeps the original `app`, `resource` and `meta`: the chunks are
 * all the same hop, so they must carry the same schema version, resource block
 * and process chain. Dropping `meta` here left chunked batches unversioned and
 * invisible to the receiver's loop detection. When no caps are set the input is
 * returned as a single-element array (zero-copy fast path).
 */
export function splitLoggerBatch(
    batch: LoggerObjectBatch,
    caps: SplitBatchCaps = {},
): LoggerObjectBatch[] {
    const { maxEvents, maxBytes } = caps
    const logs = batch.logs

    if (logs.length === 0) return [batch]
    if (!maxEvents && !maxBytes) return [batch]

    // Envelope allowance: the `{ logs: [...], app, meta }` wrapper plus a fresh
    // meta object. Reserve room so a full-byte chunk still fits after wrapping.
    const envelopeBytes = maxBytes
        ? JSON.stringify({ logs: [], app: batch.app, resource: batch.resource, meta: batch.meta }).length + 256
        : 0
    const byteBudget = maxBytes ? Math.max(0, maxBytes - envelopeBytes) : 0

    const chunks: LoggerObjectBatch[] = []
    let current: typeof logs = []
    let currentBytes = 0

    const flush = () => {
        if (current.length === 0) return
        chunks.push({ logs: current, app: batch.app, resource: batch.resource, meta: batch.meta })
        current = []
        currentBytes = 0
    }

    for (const log of logs) {
        const logBytes = maxBytes ? JSON.stringify(log).length + 1 : 0

        const overCount = maxEvents ? current.length >= maxEvents : false
        const overBytes = maxBytes && current.length > 0
            ? currentBytes + logBytes > byteBudget
            : false

        if (overCount || overBytes) {
            flush()
        }

        current.push(log)
        currentBytes += logBytes
    }

    flush()

    return chunks
}
