import { defu, createDefu } from 'defu'

import type {
    ModuleOptions,
    FroggerPreset,
} from '../types/module-options'
import {
    DEFAULT_LOGGING_ENDPOINT,
    DEFAULT_WEBSOCKET_ENDPOINT,
} from '../types/module-options'

import type { BatchOptions } from '../types/batch'
import type { LogContext } from '../types/log'
import type { FileOptions } from '../types/file'
import { DEFAULT_FILE } from '../types/file'
import type { AppInfoOptions } from '../../app-info/types'
import type { ScrubberOptions } from '../../scrubber/options'
import { compileScrubRules } from '../../scrubber/compile'
import type { RateLimitingOptions } from '../../rate-limiter/types'
import type { WebsocketOptions } from '../../websocket/types/options'
import type { GlobalErrorCaptureOptions } from '../types/global-error'
import type {
    FroggerTransportConfig,
    HttpTransportConfig,
    FileTransportConfig,
    ObserveTransportConfig,
    MemoryTransportConfig,
    ResolvedHttpTransport,
    ResolvedFileTransport,
    ResolvedServerTransport,
} from '../types/transports'
import type { InternalLogLevel } from './internal-log'
import { froggerInternal } from './internal-log'
import { DEFAULT_SPAN_EVENTS, type ResolvedSpanEvents } from './span-events'
import type { ResolvedMetricsOptions } from '../../metrics/shared/types/metric-options'
import { resolveMetricsOptions } from '../../metrics/shared/utils/resolve-metrics'

/**
 * Options resolution for Frogger.
 *
 * Frogger ships "quiet by default": a bare install logs to console only and
 * nothing else (file logging is opt-in via `fileTransport()`). The heavy
 * subsystems — scrubbing, rate-limiting, the dev
 * websocket live-stream, and global error capture — are **opt-in**, selected
 * either individually or via a {@link FroggerPreset}.
 *
 * This module owns ALL defaults (the `defineNuxtModule` `defaults` block is
 * intentionally empty) so that `resolveFroggerOptions` can tell a user-set key
 * apart from an unset one, and apply preset → base precedence correctly:
 *
 *   explicit user option  >  preset toggle  >  off (subsystems) / base default (core)
 */

export const DEFAULT_PRESET: FroggerPreset = 'minimal'

/** Which heavy subsystems each preset enables. */
interface PresetToggles {
    scrub: boolean
    rateLimit: boolean
    websocket: boolean
    errorCapture: boolean
}

export const FROGGER_PRESETS: Record<FroggerPreset, PresetToggles> = {
    // console only — the bare-install default. Heavy subsystems all off.
    minimal: { scrub: false, rateLimit: false, websocket: false, errorCapture: false },
    // production-sensible safety net: redaction, ingest rate-limiting and error
    // capture on; the dev-only websocket live-stream stays off.
    standard: { scrub: true, rateLimit: true, websocket: false, errorCapture: true },
    // everything on, including the dev websocket live-stream (pre-0.2 behaviour).
    full: { scrub: true, rateLimit: true, websocket: true, errorCapture: true },
}

// --- Detailed default configs, applied only when a subsystem is enabled. -----

export const DEFAULT_APP: AppInfoOptions = 'nuxt-frogger'

export const DEFAULT_BATCH: BatchOptions = {
    maxSize: 200,
    maxAge: 15000,
    retryOnFailure: true,
    maxRetries: 5,
    retryDelay: 10000,
    sortingWindowMs: 3000,
}

export const DEFAULT_PUBLIC_BATCH: BatchOptions = {
    maxAge: 3000,
    maxSize: 100,
    retryOnFailure: true,
    maxRetries: 3,
    retryDelay: 3000,
    sortingWindowMs: 1000,
}

// DEFAULT_FILE now lives in ../types/file (a dependency-light module) so
// FileTransport can share it; re-exported here for existing importers/tests.
export { DEFAULT_FILE }

// maxDepth is deliberately absent: undefined = unlimited recursion (the
// scrubber is cycle-safe). Set a number to bound how deep nested ctx objects
// are scrubbed.
export const DEFAULT_SCRUB: ScrubberOptions = {
    deepScrub: true,
    preserveTypes: true,
}

/**
 * Console mirroring of application logs, resolved per runtime. Not part of any
 * preset: it is a core output channel, not an opt-in subsystem.
 */
export interface ResolvedConsoleOutput {
    client: boolean
    server: boolean
}

export const DEFAULT_CONSOLE_OUTPUT: ResolvedConsoleOutput = {
    client: true,
    server: true,
}

export const DEFAULT_RATE_LIMIT: RateLimitingOptions = {
    storage: {
        driver: undefined,
        options: {},
    },
    limits: {
        global: 10000,
        perIp: 100,
        perReporter: 50,
        perApp: 30,
    },
    windows: {
        global: 60,
        perIp: 60,
        perReporter: 60,
        perApp: 60,
    },
    blocking: {
        enabled: true,
        escalationResetHours: 24,
        timeouts: [60, 300, 1800],
        violationsBeforeBlock: 3,
        finalBanHours: 12,
    },
}

export const DEFAULT_WEBSOCKET: WebsocketOptions = {
    route: DEFAULT_WEBSOCKET_ENDPOINT,
    defaultChannel: 'main',
    maxConcurrentQueries: 10,
    maxQueryResults: 1000,
    defaultQueryTimeout: 30000,
}

type ClientErrorCapture = GlobalErrorCaptureOptions['client']
type ServerErrorCapture = GlobalErrorCaptureOptions['server']

export const DEFAULT_ERROR_CAPTURE_CLIENT: ClientErrorCapture = {
    includeComponent: true,
    includeComponentProps: true,
    includeComponentOuterHTML: true,
    includeInfo: true,
    includeStack: true,
}

export const DEFAULT_ERROR_CAPTURE_SERVER: ServerErrorCapture = {
    includeRequestContext: true,
    includeHeaders: true,
    includeRejectionHandled: false,
    includeWarnings: false,
    includeStack: true,
    dedupe: true,
}

// --- Resolved shape ----------------------------------------------------------

export interface ResolvedErrorCapture {
    client: ClientErrorCapture | false
    server: ServerErrorCapture | false
}

/**
 * Fully-resolved options. Every preset-controlled subsystem is normalised to
 * either `false` (off) or a complete config object (on), so downstream wiring
 * and runtime-config builders never have to re-derive on/off state.
 */
export interface ResolvedFroggerOptions {
    preset: FroggerPreset
    clientModule: boolean
    serverModule: boolean | { autoEventCapture?: boolean }
    app: AppInfoOptions
    /** Static base context stamped onto every ambient log (serializable only). */
    context?: LogContext
    verbose?: boolean
    logLevel?: InternalLogLevel
    consoleOutput: ResolvedConsoleOutput
    batch: BatchOptions | false
    /**
     * Span-end events: every `span()` emits one row with its duration and
     * ok/error status. `false` restores span-as-correlation-scope-only.
     */
    spans: ResolvedSpanEvents
    scrub: ScrubberOptions | false
    rateLimit: RateLimitingOptions | false
    websocket: WebsocketOptions | false
    errorCapture: ResolvedErrorCapture
    /**
     * Metrics subsystem, normalised to `false` (fully off — no plugin, route,
     * runtime-config keys or singleton) or a complete config object (on).
     * Independent of `preset`, like `transports`.
     */
    metrics: ResolvedMetricsOptions | false
    /**
     * Log destinations, split by which side ships them. Server transports
     * (HTTP + file) land in `runtimeConfig.frogger` (keys stay server-side);
     * client transports (HTTP only) land in `runtimeConfig.public.frogger`
     * (⚠️ keys are bundled). A bare install has empty lists — console only.
     */
    transports: {
        server: ResolvedServerTransport[]
        client: ResolvedHttpTransport[]
    }
    public: {
        /** `false` when the client POST to the app's own endpoint is disabled. */
        endpoint: string | false
        baseUrl?: string
        batch: BatchOptions | false
    }
}

export type {
    ResolvedHttpTransport,
    ResolvedFileTransport,
    ResolvedServerTransport,
} from '../types/transports'

// --- Normalisers -------------------------------------------------------------

/**
 * Deep-merge that REPLACES arrays instead of concatenating them (plain `defu`
 * appends), so a user-provided array (e.g. `rateLimit.blocking.timeouts`)
 * overrides the default rather than prepending to it.
 */
const mergeConfig = createDefu((obj, key, value) => {
    if (Array.isArray(value)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (obj as any)[key] = value
        return true
    }
})

/**
 * Normalise an opt-in subsystem option to `false` or a full config object.
 * `false`/`undefined` → off; `true` → defaults; partial object → merged onto
 * defaults.
 *
 * Always returns a FRESH object: the shared `DEFAULT_*` consts are deep-cloned
 * (via `structuredClone`) so a resolved config can never alias — and therefore
 * never mutate — the module-level defaults across repeated `resolveFroggerOptions`
 * calls.
 */
export function normalizeToggle<T extends object>(
    value: T | boolean | undefined,
    defaults: T,
): T | false {
    if (value === false || value === undefined) return false
    if (value === true) return structuredClone(defaults)
    return mergeConfig(value, structuredClone(defaults)) as T
}

// nuxt-observe ingest contract (verified against its source).
const OBSERVE_INGEST_PATH = '/api/observe/ingest/frogger'
const OBSERVE_MAX_BATCH_EVENTS = 500
const OBSERVE_MAX_BODY_BYTES = 950 * 1024

/**
 * Normalise an `http` (or untagged, backward-compat) transport entry into a
 * `ResolvedHttpTransport`. Resolves the `url` shorthand into `baseUrl` +
 * `endpoint`, keeps `apiKey` discrete (never folded into `headers`), carries
 * `apiKeyLocation` (default `'header'`). Returns `null` for an unusable entry.
 */
function normalizeHttp(t: HttpTransportConfig): ResolvedHttpTransport | null {
    let baseUrl = t.baseUrl ?? ''
    let endpoint = t.endpoint ?? ''

    if (t.url) {
        try {
            const u = new URL(t.url)
            baseUrl = u.origin
            endpoint = u.pathname + u.search
        }
        catch {
            froggerInternal.warn(`Invalid transport url "${t.url}" — skipping this transport.`)
            return null
        }
    }

    if (!endpoint && !baseUrl) {
        froggerInternal.warn('Transport entry has no url/baseUrl/endpoint — skipping.')
        return null
    }

    return {
        type: 'http',
        name: t.name ?? (baseUrl + endpoint),
        baseUrl,
        endpoint,
        apiKey: t.apiKey || undefined,
        apiKeyLocation: t.apiKeyLocation ?? 'header',
        headers: { ...t.headers },
        vendor: t.vendor,
        timeout: t.timeout,
        retryOnFailure: t.retryOnFailure,
        maxRetries: t.maxRetries,
        retryDelay: t.retryDelay,
    }
}

/** Normalise a `file` entry into a `ResolvedFileTransport`. Server-only. */
function normalizeFile(t: FileTransportConfig): ResolvedFileTransport {
    const { type: _type, name, ...fileOptions } = t
    return {
        type: 'file',
        name: name ?? 'file',
        options: defu(fileOptions, DEFAULT_FILE) as Required<FileOptions>,
    }
}

/**
 * Expand an `observe` entry into per-side `ResolvedHttpTransport`s encoding the
 * nuxt-observe contract: header auth server-side, query auth browser-side, and
 * the ingest path + batch caps on both. Returns `null` on an invalid `url`.
 */
function normalizeObserve(t: ObserveTransportConfig): {
    server?: ResolvedHttpTransport
    client?: ResolvedHttpTransport
} | null {
    let origin: string
    try {
        origin = new URL(t.url).origin
    }
    catch {
        froggerInternal.warn(`Invalid observe url "${t.url}" — skipping this transport.`)
        return null
    }

    // Key is never embedded in `name` (diagnostics may surface it).
    const name = t.name ?? `observe (${origin})`

    const base = {
        type: 'http' as const,
        name,
        baseUrl: origin,
        endpoint: OBSERVE_INGEST_PATH,
        headers: {} as Record<string, string>,
        timeout: t.timeout,
        retryOnFailure: t.retryOnFailure,
        maxRetries: t.maxRetries,
        retryDelay: t.retryDelay,
        maxBatchEvents: OBSERVE_MAX_BATCH_EVENTS,
        maxBodyBytes: OBSERVE_MAX_BODY_BYTES,
    }

    const result: { server?: ResolvedHttpTransport; client?: ResolvedHttpTransport } = {}

    if (t.server !== false) {
        result.server = { ...base, apiKey: t.key, apiKeyLocation: 'header' }
    }
    if (t.client === true) {
        result.client = { ...base, apiKey: t.key, apiKeyLocation: 'query', publicKeyOk: true }
    }

    return result
}

/**
 * Split the declarative `transports` list into server-bound (HTTP + file) and
 * client-bound (HTTP only) normalised transports. Switches on `type` (untagged
 * = `http` for backward compat). `server` defaults on, `client` defaults off;
 * an entry can target both. Invalid entries are dropped.
 */
function resolveTransports(transports: FroggerTransportConfig[] | undefined): {
    server: ResolvedServerTransport[]
    client: ResolvedHttpTransport[]
} {
    const server: ResolvedServerTransport[] = []
    const client: ResolvedHttpTransport[] = []

    for (const t of transports ?? []) {
        const type = t.type ?? 'http'

        if (type === 'file') {
            const file = t as FileTransportConfig
            if ((file as { client?: boolean }).client === true) {
                froggerInternal.warn('A `file` transport is server-only; `client: true` is ignored.')
            }
            server.push(normalizeFile(file))
            continue
        }

        if (type === 'memory') {
            const mem = t as MemoryTransportConfig
            if (mem.client === true) {
                froggerInternal.warn('A `memory` transport is server-only; `client: true` is ignored.')
            }
            server.push({ type: 'memory', name: mem.name ?? 'memory' })
            continue
        }

        if (type === 'observe') {
            const normalized = normalizeObserve(t as ObserveTransportConfig)
            if (!normalized) continue
            if (normalized.server) server.push(normalized.server)
            if (normalized.client) client.push(normalized.client)
            continue
        }

        // 'http' or untagged
        const http = t as HttpTransportConfig
        const normalized = normalizeHttp(http)
        if (!normalized) continue
        if (http.server !== false) server.push(normalized)
        if (http.client === true) client.push(normalized)
    }

    return { server, client }
}

type ErrorCaptureInput =
    | boolean
    | {
        client?: ClientErrorCapture | boolean
        server?: ServerErrorCapture | boolean
    }

/**
 * Normalise `consoleOutput` to a per-runtime pair. A bare boolean applies to
 * both sides; a partial object leaves the unspecified side at its default (on).
 */
export function normalizeConsoleOutput(
    value: boolean | { client?: boolean; server?: boolean } | undefined,
): ResolvedConsoleOutput {
    if (value === undefined) return { ...DEFAULT_CONSOLE_OUTPUT }
    if (typeof value === 'boolean') return { client: value, server: value }
    return {
        client: value.client ?? DEFAULT_CONSOLE_OUTPUT.client,
        server: value.server ?? DEFAULT_CONSOLE_OUTPUT.server,
    }
}

function normalizeErrorCapture(value: ErrorCaptureInput | undefined): ResolvedErrorCapture {
    if (value === false || value === undefined) {
        return { client: false, server: false }
    }
    if (value === true) {
        return {
            client: normalizeToggle(true, DEFAULT_ERROR_CAPTURE_CLIENT),
            server: normalizeToggle(true, DEFAULT_ERROR_CAPTURE_SERVER),
        }
    }
    return {
        client: normalizeToggle(value.client, DEFAULT_ERROR_CAPTURE_CLIENT),
        server: normalizeToggle(value.server, DEFAULT_ERROR_CAPTURE_SERVER),
    }
}

/**
 * Normalise scrub config, then compile every rule's field patterns into a
 * serialisation-safe form (RegExp → `{ source, flags }`) so the rule set
 * survives being written into Nuxt runtime config and JSON-serialised across the
 * SSR→client boundary. Enabling scrubbing never injects rules — an enabled
 * scrubber with no user rules is a deliberate no-op.
 */
function resolveScrub(value: ScrubberOptions | boolean | undefined): ScrubberOptions | false {
    const normalized = normalizeToggle(value, DEFAULT_SCRUB)
    if (normalized === false) return false
    if (normalized.rules?.length) {
        normalized.rules = compileScrubRules(normalized.rules)
    }
    return normalized
}

/**
 * Normalise the `spans` option: on by default (span-end events at info),
 * `false` disables, a partial object overrides the level.
 */
function resolveSpans(value: boolean | { level?: string } | undefined): ResolvedSpanEvents {
    if (value === false) return false
    if (typeof value === 'object' && value !== null && value.level) {
        return { level: value.level as Exclude<ResolvedSpanEvents, false>['level'] }
    }
    return structuredClone(DEFAULT_SPAN_EVENTS)
}

/**
 * Resolve raw (already user-merged) module options into a fully-normalised
 * config. `options` should be the result of merging `frogger.config.ts` over
 * the `nuxt.config` `frogger` key — NOT pre-filled with subsystem defaults, or
 * the preset/opt-in precedence cannot be honoured.
 */
export function resolveFroggerOptions(options: ModuleOptions = {}): ResolvedFroggerOptions {
    const preset = options.preset && FROGGER_PRESETS[options.preset]
        ? options.preset
        : DEFAULT_PRESET
    const toggles = FROGGER_PRESETS[preset]

    // For each opt-in subsystem: an explicitly-set user value wins; otherwise
    // fall back to the preset's toggle. `??` is deliberate so an explicit
    // `false` is preserved (it is not nullish).
    const scrub = options.scrub ?? toggles.scrub
    const rateLimit = options.rateLimit ?? toggles.rateLimit
    const websocket = options.websocket ?? toggles.websocket
    const errorCapture = (options.errorCapture ?? toggles.errorCapture) as ErrorCaptureInput

    // The top-level `file` option was removed in favour of `fileTransport()`.
    // Warn if a legacy config still sets it so the file logs aren't silently lost.
    if ((options as { file?: unknown }).file !== undefined) {
        froggerInternal.warn(
            'The top-level `file` option was removed; add `fileTransport({...})` to `transports` instead.',
        )
    }

    // `public.endpoint: false` deliberately disables the client POST to the
    // app's own route; otherwise fall back to the default ingest endpoint.
    const endpoint = options.public?.endpoint === false
        ? false
        : options.public?.endpoint ?? DEFAULT_LOGGING_ENDPOINT

    return {
        preset,
        clientModule: options.clientModule ?? true,
        serverModule: options.serverModule ?? { autoEventCapture: true },
        app: options.app ?? DEFAULT_APP,
        context: options.context,
        verbose: options.verbose,
        logLevel: options.logLevel,
        consoleOutput: normalizeConsoleOutput(options.consoleOutput),
        batch: options.batch === false ? false : defu(options.batch, DEFAULT_BATCH),
        spans: resolveSpans(options.spans),
        scrub: resolveScrub(scrub),
        rateLimit: normalizeToggle(rateLimit, DEFAULT_RATE_LIMIT),
        websocket: normalizeToggle(websocket, DEFAULT_WEBSOCKET),
        errorCapture: normalizeErrorCapture(errorCapture),
        metrics: resolveMetricsOptions(options.metrics),
        transports: resolveTransports(options.transports),
        public: {
            endpoint,
            baseUrl: options.public?.baseUrl,
            batch: options.public?.batch === false
                ? false
                : defu(options.public?.batch, DEFAULT_PUBLIC_BATCH),
        },
    }
}
