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

    /** Standard HttpTransport tuning (falls back to HttpTransport defaults). */
    vendor?: string
    timeout?: number
    retryOnFailure?: boolean
    maxRetries?: number
    retryDelay?: number
}

/**
 * A single normalised transport as emitted by `resolveFroggerOptions` into
 * `runtimeConfig`. `apiKey` is kept discrete (never folded into `headers`) so
 * send-site code applies `x-api-key` uniformly and diagnostics can redact it.
 */
export interface ResolvedHttpTransport {
    name: string
    baseUrl: string
    endpoint: string
    apiKey?: string
    /** Does NOT include `x-api-key`; that's applied at send time from `apiKey`. */
    headers: Record<string, string>
    vendor?: string
    timeout?: number
    retryOnFailure?: boolean
    maxRetries?: number
    retryDelay?: number
}
