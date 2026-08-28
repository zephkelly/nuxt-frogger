import type { LogType } from 'consola'
import type { FileOptions } from './file'

/**
 * Severity threshold for one destination, as a level NAME.
 *
 * This is a threshold, not a set: `minLevel: 'warn'` sends warn and everything
 * more important. It composes with the logger's own `level` the way pino's
 * two-stage gate does - the logger decides what exists, each transport decides
 * what it wants - so "warn and above to the HTTP sink, everything to the file"
 * is one word of config per destination.
 *
 * The low-level `levels?: number[]` exact-membership escape hatch still exists
 * on `BatchTransportOptions` for the rare case that wants it.
 */
export type TransportMinLevel = LogType

/**
 * Declarative log-transport destination. Each entry in `transports` forwards
 * every log batch to an HTTP ingest URL — from the Nitro server queue
 * (`server`, default on) and/or directly from the browser log queue (`client`,
 * default off).
 *
 * This is the declarative complement to registering an `HttpTransport`
 * programmatically via `addGlobalTransport()`. Entries are plain serializable
 * objects (they travel through `runtimeConfig`), so anything the declarative
 * shape can't express (custom classes/closures) still goes through the
 * imperative path.
 */
export interface HttpTransportConfig {
    /**
     * Discriminator. Optional for backward compatibility — an untagged object
     * (no `type`) is treated as an `http` transport.
     */
    type?: 'http'

    /**
     * Full ingest URL — the friendly shorthand. Equivalent to setting `baseUrl`
     * to its origin and `endpoint` to its path. If both `url` and
     * `baseUrl`/`endpoint` are given, `url` wins.
     */
    url?: string

    /** Split form (parity with `HttpTransportOptions`). */
    baseUrl?: string
    endpoint?: string

    /**
     * Optional API key. When set, Frogger sends it as the `x-api-key` header on
     * every batch POST to this destination. This is the ONLY auth header Frogger
     * emits for a transport — for consistency across the fleet.
     */
    apiKey?: string

    /**
     * Where the API key is sent. `'header'` (default) sets `x-api-key`;
     * `'query'` appends `?key=` to the request URL (for ingest APIs whose CORS
     * design expects a bare browser `$fetch` with no custom headers).
     *
     * @default 'header'
     */
    apiKeyLocation?: 'header' | 'query'

    /** Extra headers merged onto each request (after `x-api-key`). */
    headers?: Record<string, string>

    /**
     * Fan out to this destination from the browser client log queue.
     *
     * @default false
     * ⚠️ A client transport's `apiKey`/`headers` are shipped in the public
     * bundle — only ever use a write-only, per-service, rate-limited ingest key.
     */
    client?: boolean

    /**
     * Fan out to this destination from the Nitro server log queue.
     *
     * @default true
     */
    server?: boolean

    /** Optional label for diagnostics / dedupe. Defaults to the resolved URL. */
    name?: string

    /** Only send records at this level or more important. See {@link TransportMinLevel}. */
    minLevel?: TransportMinLevel

    /**
     * Body shape. `'otlp-logs'` emits an OTLP/HTTP ExportLogsServiceRequest,
     * which every OpenTelemetry-speaking backend accepts.
     *
     * @default 'frogger'
     */
    shape?: 'frogger' | 'otlp-logs'

    /** Standard HttpTransport tuning (falls back to HttpTransport defaults). */
    vendor?: string
    timeout?: number
    retryOnFailure?: boolean
    maxRetries?: number
    retryDelay?: number
}

/**
 * Declarative file-logging destination. Server-only: writes rotated JSON-lines
 * files to disk. Add `fileTransport()` to `transports` to opt into persistent
 * file logging (Frogger no longer writes files by default).
 */
export interface FileTransportConfig extends FileOptions {
    type: 'file'
    /** Optional label for diagnostics. */
    name?: string
    /** Only write records at this level or more important. */
    minLevel?: TransportMinLevel
}

/**
 * Declarative JSON-lines-to-stdout destination. Server-only, needs no user
 * infrastructure, and works on every Nitro preset including edge - which is
 * where `fileTransport()` cannot go.
 */
export interface StdoutTransportConfig {
    type: 'stdout'
    name?: string
    /** Only write records at this level or more important. */
    minLevel?: TransportMinLevel
    /** Emit from the Nitro server queue. @default true */
    server?: boolean
}

/**
 * Declarative destination for a nuxt-observe deployment. Encodes the observe
 * ingest contract (ingest path, header-vs-query auth, batch caps) so a single
 * `observeTransport({ url, key })` entry is enough to ship logs there.
 */
export interface ObserveTransportConfig {
    type: 'observe'
    /** Observe deployment origin, e.g. `https://observe.app.com`. */
    url: string
    /** Ingest API key. Sent as `x-api-key` (server) or `?key=` (browser). */
    key: string
    /**
     * Fan out directly from the browser. The key becomes bundle-visible; observe
     * write keys are public by design, so no build warning is emitted.
     *
     * @default false
     */
    client?: boolean
    /**
     * Fan out from the Nitro server queue.
     *
     * @default true
     */
    server?: boolean
    name?: string
    /** Only send records at this level or more important. */
    minLevel?: TransportMinLevel
    timeout?: number
    retryOnFailure?: boolean
    maxRetries?: number
    retryDelay?: number
}

/**
 * Declarative in-memory capture destination. Server-only (for v1, mirroring
 * `file`). Every log batch is pushed into an array instead of a real sink, so a
 * test can read back exactly what the app logged.
 *
 * A `name` writes into a process-global registry shared with the
 * `nuxt-frogger/testing` helpers (`getCapturedLogs({ name })`); an unnamed entry
 * keeps a private array only reachable through a direct `MemoryTransport`
 * reference.
 */
export interface MemoryTransportConfig {
    type: 'memory'
    /**
     * Registry key. When set, the constructed `MemoryTransport` shares its array
     * with `getCapturedLogs({ name })` from `nuxt-frogger/testing`.
     */
    name?: string
    /**
     * Capture from the browser client log queue. Server-only for v1 (matching
     * `file`); `client: true` is ignored with a warning.
     *
     * @default false
     */
    client?: boolean
    /**
     * Capture from the Nitro server log queue.
     *
     * @default true
     */
    server?: boolean
    /** Only capture records at this level or more important. */
    minLevel?: TransportMinLevel
}

/** Any declarative transport entry, tagged by `type`. */
export type FroggerTransportConfig =
    | HttpTransportConfig
    | FileTransportConfig
    | StdoutTransportConfig
    | ObserveTransportConfig
    | MemoryTransportConfig

/**
 * A single normalised HTTP transport as emitted by `resolveFroggerOptions` into
 * `runtimeConfig`. `apiKey` is kept discrete (never folded into `headers`) so
 * send-site code applies auth uniformly and diagnostics can redact it.
 */
export interface ResolvedHttpTransport {
    type: 'http'
    name: string
    baseUrl: string
    endpoint: string
    apiKey?: string
    /** Where `apiKey` is applied at send time. @default 'header' */
    apiKeyLocation?: 'header' | 'query'
    /** Does NOT include `x-api-key`; that's applied at send time from `apiKey`. */
    headers: Record<string, string>
    vendor?: string
    timeout?: number
    retryOnFailure?: boolean
    maxRetries?: number
    retryDelay?: number
    /** Max events per outgoing batch chunk (observe: 500). Unset = no cap. */
    maxBatchEvents?: number
    /** Max serialized body bytes per chunk (observe: ~950 KiB). Unset = no cap. */
    maxBodyBytes?: number
    /**
     * Suppresses the bundle-visible-apiKey build warning for a client entry.
     * Set for observe browser keys (write-only public by design).
     */
    publicKeyOk?: boolean
    /** Resolved severity threshold for this destination. */
    minLevel?: TransportMinLevel
    /** Resolved body shape. @default 'frogger' */
    shape?: 'frogger' | 'otlp-logs'
}

/**
 * A single normalised file transport as emitted into `runtimeConfig.frogger`.
 * Server-only — never lands in the client bundle.
 */
export interface ResolvedFileTransport {
    type: 'file'
    name: string
    options: Required<FileOptions>
    minLevel?: TransportMinLevel
}

/** A normalised stdout transport as emitted into `runtimeConfig.frogger`. */
export interface ResolvedStdoutTransport {
    type: 'stdout'
    name: string
    minLevel?: TransportMinLevel
}

/**
 * A single normalised memory transport as emitted into `runtimeConfig.frogger`.
 * Server-only. Carries only the registry `name` — the captured array lives in
 * the process-global store keyed by that name, never in runtime config.
 */
export interface ResolvedMemoryTransport {
    type: 'memory'
    name: string
    minLevel?: TransportMinLevel
}

/** A server-bound transport is an HTTP, file, stdout, or memory destination. */
export type ResolvedServerTransport =
    | ResolvedHttpTransport
    | ResolvedFileTransport
    | ResolvedStdoutTransport
    | ResolvedMemoryTransport
