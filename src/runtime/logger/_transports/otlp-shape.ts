import type { LoggerObjectBatch } from '../../shared/types/batch'
import type { LoggerObject } from '../../shared/types/log'

/**
 * Map a Frogger batch onto an OTLP/HTTP `ExportLogsServiceRequest` body.
 *
 * A pure mapping, applied immediately before the POST, so all of the
 * transport's retry / backoff / chunking / 4xx-drop machinery is reused
 * unchanged. No `@opentelemetry/*` dependency: the body is a nested object
 * literal, and taking the SDK for it would pull a provider/processor/exporter
 * assembly into a package whose whole pitch is that it needs none.
 *
 * Only `otlp-logs` is offered. One shape reaches the Collector, Alloy, SigNoz,
 * Datadog, Axiom, Better Stack and ClickStack at once, and every additional
 * shape is a wire format frogger would have to keep correct forever.
 */
export function toOtlpLogs(batch: LoggerObjectBatch): Record<string, unknown> {
    return {
        resourceLogs: [{
            resource: {
                attributes: otlpAttributes(resourceAttributes(batch)),
            },
            scopeLogs: [{
                scope: { name: 'nuxt-frogger' },
                logRecords: batch.logs.map(log => toLogRecord(log, batch)),
            }],
        }],
    }
}

function resourceAttributes(batch: LoggerObjectBatch): Record<string, unknown> {
    const attributes: Record<string, unknown> = { ...batch.resource }

    // `app` predates `resource`; fill the standard keys from it when the
    // batch came from an emitter that has not been upgraded.
    if (batch.app?.name) attributes['service.name'] ??= batch.app.name
    if (batch.app?.version) attributes['service.version'] ??= batch.app.version

    return attributes
}

function toLogRecord(log: LoggerObject, batch: LoggerObjectBatch): Record<string, unknown> {
    // OTLP timestamps are unix NANOseconds, as strings (they exceed 2^53).
    const timeUnixNano = String(BigInt(Math.trunc(log.time)) * 1_000_000n)

    const attributes: Record<string, unknown> = { ...log.ctx }

    // Correlation keys become resource-ish attributes under their semconv
    // names, so an OTLP backend indexes them the way it indexes everything else.
    if (log.session) attributes['session.id'] = log.session.id
    if (log.user) attributes['user.id'] = log.user
    if (log.route) attributes['http.route'] = log.route
    if (log.kind) attributes['frogger.kind'] = log.kind
    if (log.source?.name) attributes['frogger.source.name'] = log.source.name

    const record: Record<string, unknown> = {
        timeUnixNano,
        // Frogger's `sev` IS the OTel SeverityNumber, which is why it exists.
        severityNumber: log.sev,
        severityText: log.type,
        body: { stringValue: String(log.msg ?? '') },
        attributes: otlpAttributes(attributes),
    }

    if (log.obsTime !== undefined) {
        record.observedTimeUnixNano = String(BigInt(Math.trunc(log.obsTime)) * 1_000_000n)
    }

    if (log.trace?.traceId) {
        record.traceId = log.trace.traceId
        if (log.trace.spanId) record.spanId = log.trace.spanId
        // flags is a byte; OTLP wants it as a number.
        if (log.trace.flags) record.flags = Number.parseInt(log.trace.flags, 16)
    }

    void batch
    return record
}

/** OTLP's `KeyValue[]` with its `AnyValue` tagged-union values. */
function otlpAttributes(source: Record<string, unknown>): { key: string, value: Record<string, unknown> }[] {
    const out: { key: string, value: Record<string, unknown> }[] = []

    for (const [key, value] of Object.entries(source)) {
        if (value === undefined || value === null) continue
        out.push({ key, value: anyValue(value) })
    }

    return out
}

function anyValue(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') return { stringValue: value }
    if (typeof value === 'boolean') return { boolValue: value }
    if (typeof value === 'number') {
        return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
    }
    if (Array.isArray(value)) {
        return { arrayValue: { values: value.map(anyValue) } }
    }
    if (value && typeof value === 'object') {
        return {
            kvlistValue: {
                values: Object.entries(value as Record<string, unknown>)
                    .filter(([, v]) => v !== undefined && v !== null)
                    .map(([k, v]) => ({ key: k, value: anyValue(v) })),
            },
        }
    }

    // Anything else (function, symbol) is not representable; stringify rather
    // than emit an empty AnyValue, which some receivers reject.
    return { stringValue: String(value) }
}
