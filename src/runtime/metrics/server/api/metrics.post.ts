import { H3Error, eventHandler, readRawBody, getHeader, createError } from 'h3'

import type { MetricObjectBatch } from '../../shared/types/metric-batch'
import { ServerMetricsQueueService } from '../services/server-metrics-queue'
import { getFroggerRateLimiter } from '../../../rate-limiter'
import { froggerInternal } from '../../../shared/utils/internal-log'



/**
 * Detect a circular metrics-processing chain (same convention as the log
 * ingest route: a duplicate in `meta.processChain`, or a batch older than 10
 * minutes indicating a retry loop).
 */
function detectMetricsLoop(batch: MetricObjectBatch): { isLoop: boolean; reason?: string } {
    if (!batch.meta) return { isLoop: false }

    const chain = batch.meta.processChain
    if (chain && chain.length > 0) {
        const chainSet = new Set(chain)
        if (chainSet.size !== chain.length) {
            return { isLoop: true, reason: 'Circular metrics processing chain detected' }
        }
    }

    if (batch.meta.time) {
        const age = Date.now() - batch.meta.time
        if (age > 600000) {
            return { isLoop: true, reason: `Metrics older than 10 minutes (${Math.round(age / 1000)}s) - possible retry loop` }
        }
    }

    return { isLoop: false }
}

export default eventHandler(async (event) => {
    const contentLength = getHeader(event, 'content-length')
    const maxRequestSize = 1024 * 1024

    if (contentLength && parseInt(contentLength) > maxRequestSize) {
        throw createError({
            statusCode: 413,
            statusMessage: 'Request Too Large',
            data: { error: 'REQUEST_TOO_LARGE', maxSize: maxRequestSize },
        })
    }

    // Shares the log ingest's per-IP rate-limit budget (inert when the
    // rateLimit subsystem is off) - a metrics burst counts against the same
    // window as logs, which is the right trade at web-vitals volume.
    await getFroggerRateLimiter().check(event)

    // Page-exit batches arrive via `navigator.sendBeacon`, which sends a
    // `text/plain;charset=UTF-8` body - h3's `readBody` only JSON-parses when
    // the content-type is exactly `application/json`, so a beacon body would be
    // silently dropped. Read the raw string and parse it ourselves so both the
    // in-session `$fetch` (application/json) and beacon (text/plain) paths work.
    let batch: MetricObjectBatch
    try {
        const raw = await readRawBody(event)
        if (!raw || typeof raw !== 'string') {
            throw new Error('empty body')
        }
        batch = JSON.parse(raw) as MetricObjectBatch
    }
    catch {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid metrics batch body',
            data: { error: 'FROGGER_METRICS_BAD_BODY' },
        })
    }

    try {
        if (!batch || !Array.isArray(batch.metrics)) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Invalid metrics batch',
                data: { error: 'FROGGER_METRICS_BAD_BODY' },
            })
        }

        const loop = detectMetricsLoop(batch)
        if (loop.isLoop) {
            froggerInternal.error(`🚨 METRICS LOOP DETECTED: ${loop.reason}`)
            throw createError({
                statusCode: 400,
                statusMessage: 'Metrics loop detected',
                data: { error: 'FROGGER_METRICS_LOOP_DETECTED', reason: loop.reason },
            })
        }

        // Stamp the raw User-Agent server-side (UA parsing / geo is deferred to
        // Phase 3 - zero new deps here). Rides the batch envelope, never a point.
        const ua = getHeader(event, 'user-agent')
        if (ua) {
            batch.context = { ...batch.context, ua }
        }

        ServerMetricsQueueService.getInstance().enqueueBatch(batch)
    }
    catch (error: unknown) {
        if (error instanceof H3Error) {
            throw error
        }
        throw createError({
            statusCode: 500,
            statusMessage: 'Internal Server Error',
        })
    }
})
