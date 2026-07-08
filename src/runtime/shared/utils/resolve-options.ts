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
import type { FileOptions } from '../types/file'
import type { AppInfoOptions } from '../../app-info/types'
import type { ScrubberOptions } from '../../scrubber/options'
import { compileScrubRules } from '../../scrubber/compile'
import type { RateLimitingOptions } from '../../rate-limiter/types'
import type { WebsocketOptions } from '../../websocket/types/options'
import type { GlobalErrorCaptureOptions } from '../types/global-error'
import type { HttpTransportConfig, ResolvedHttpTransport } from '../types/transports'
import type { InternalLogLevel } from './internal-log'
import { froggerInternal } from './internal-log'

/**
 * Options resolution for Frogger.
 *
 * Frogger ships "quiet by default": a bare install logs to file + console and
 * nothing else. The heavy subsystems — scrubbing, rate-limiting, the dev
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
    // file + console only — the bare-install default.
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

export const DEFAULT_FILE: FileOptions = {
    directory: 'logs',
    fileNameFormat: 'YYYY-MM-DD.log',
    maxSize: 10 * 1024 * 1024,
    flushInterval: 1000,
    bufferMaxSize: 1 * 1024 * 1024,
    highWaterMark: 64 * 1024,
}

// maxDepth is deliberately absent: undefined = unlimited recursion (the
// scrubber is cycle-safe). Set a number to bound how deep nested ctx objects
// are scrubbed.
export const DEFAULT_SCRUB: ScrubberOptions = {
    deepScrub: true,
    preserveTypes: true,
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
    verbose?: boolean
    logLevel?: InternalLogLevel
    file: FileOptions
    batch: BatchOptions | false
    scrub: ScrubberOptions | false
    rateLimit: RateLimitingOptions | false
    websocket: WebsocketOptions | false
    errorCapture: ResolvedErrorCapture
    /**
     * Extra HTTP log destinations, split by which side ships them. Server
     * transports land in `runtimeConfig.frogger` (keys stay server-side); client
     * transports land in `runtimeConfig.public.frogger` (⚠️ keys are bundled).
     */
    transports: {
        server: ResolvedHttpTransport[]
        client: ResolvedHttpTransport[]
    }
    public: {
        endpoint: string
        baseUrl?: string
        batch: BatchOptions | false
    }
}

export type { ResolvedHttpTransport } from '../types/transports'

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
function normalizeToggle<T extends object>(
    value: T | boolean | undefined,
    defaults: T,
): T | false {
    if (value === false || value === undefined) return false
    if (value === true) return structuredClone(defaults)
    return mergeConfig(value, structuredClone(defaults)) as T
}

/**
 * Normalise a declarative transport entry into a `ResolvedHttpTransport`.
 * Resolves the `url` shorthand into `baseUrl` + `endpoint`, keeps `apiKey`
 * discrete (never folded into `headers`), and drops entries with no
 * destination. Returns `null` for an unusable entry so the caller can filter.
 */
function normalizeTransport(t: HttpTransportConfig): ResolvedHttpTransport | null {
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
        name: t.name ?? (baseUrl + endpoint),
        baseUrl,
        endpoint,
        apiKey: t.apiKey || undefined,
        headers: { ...t.headers },
        vendor: t.vendor,
        timeout: t.timeout,
        retryOnFailure: t.retryOnFailure,
        maxRetries: t.maxRetries,
        retryDelay: t.retryDelay,
    }
}

/**
 * Split the declarative `transports` list into server-bound and client-bound
 * normalised transports. `server` defaults on, `client` defaults off; an entry
 * can target both. Invalid entries are dropped.
 */
function resolveTransports(transports: HttpTransportConfig[] | undefined): {
    server: ResolvedHttpTransport[]
    client: ResolvedHttpTransport[]
} {
    const server: ResolvedHttpTransport[] = []
    const client: ResolvedHttpTransport[] = []

    for (const t of transports ?? []) {
        const normalized = normalizeTransport(t)
        if (!normalized) continue

        if (t.server !== false) server.push(normalized)
        if (t.client === true) client.push(normalized)
    }

    return { server, client }
}

type ErrorCaptureInput =
    | boolean
    | {
        client?: ClientErrorCapture | boolean
        server?: ServerErrorCapture | boolean
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

    return {
        preset,
        clientModule: options.clientModule ?? true,
        serverModule: options.serverModule ?? { autoEventCapture: true },
        app: options.app ?? DEFAULT_APP,
        verbose: options.verbose,
        logLevel: options.logLevel,
        file: defu(options.file, DEFAULT_FILE),
        batch: options.batch === false ? false : defu(options.batch, DEFAULT_BATCH),
        scrub: resolveScrub(scrub),
        rateLimit: normalizeToggle(rateLimit, DEFAULT_RATE_LIMIT),
        websocket: normalizeToggle(websocket, DEFAULT_WEBSOCKET),
        errorCapture: normalizeErrorCapture(errorCapture),
        transports: resolveTransports(options.transports),
        public: {
            endpoint: options.public?.endpoint ?? DEFAULT_LOGGING_ENDPOINT,
            baseUrl: options.public?.baseUrl,
            batch: options.public?.batch === false
                ? false
                : defu(options.public?.batch, DEFAULT_PUBLIC_BATCH),
        },
    }
}
