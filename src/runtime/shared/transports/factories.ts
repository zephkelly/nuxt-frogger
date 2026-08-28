import type { FileOptions } from '../types/file'
import type {
    FileTransportConfig,
    HttpTransportConfig,
    StdoutTransportConfig,
    ObserveTransportConfig,
    MemoryTransportConfig,
} from '../types/transports'

/**
 * Declarative transport factories.
 *
 * Pure module — no `#imports`, no Nuxt context — so it is importable from
 * `frogger.config.ts` outside the Nuxt runtime. Each factory returns a plain
 * serializable `{ type, ...options }` object that must survive
 * `structuredClone` / `updateRuntimeConfig`. Any path/URL derivation happens in
 * the resolver, never here.
 */

/**
 * Persistent file logging (rotated JSON-lines on the server's disk). Server-only.
 * Frogger writes files ONLY when this is present in `transports`.
 *
 * ```ts
 * transports: [fileTransport()]                 // defaults (logs/ directory)
 * transports: [fileTransport({ directory: 'var/log' })]
 * ```
 */
export function fileTransport(options: FileOptions & { name?: string } = {}): FileTransportConfig {
    return { type: 'file', ...options }
}

/**
 * JSON-lines to stdout. Server-only.
 *
 * The zero-infrastructure persistent sink: it works on every Nitro preset
 * including edge, where `fileTransport()` cannot go, and every platform's log
 * collector (Vector, Fluent Bit, Promtail, Docker, the host's own log view)
 * already reads it.
 *
 * ```ts
 * transports: [stdoutTransport()]
 * transports: [stdoutTransport({ minLevel: 'warn' })]
 * ```
 */
export function stdoutTransport(options: Omit<StdoutTransportConfig, 'type'> = {}): StdoutTransportConfig {
    return { type: 'stdout', ...options }
}

/**
 * A generic HTTP ingest destination. The declarative complement to
 * `addGlobalTransport(new HttpTransport(...))`.
 *
 * ```ts
 * transports: [httpTransport({ url: 'https://logs.example.com/ingest', apiKey })]
 * ```
 */
export function httpTransport(options: Omit<HttpTransportConfig, 'type'>): HttpTransportConfig {
    return { type: 'http', ...options }
}

/**
 * A nuxt-observe deployment. Encodes the observe ingest contract (path, auth,
 * caps) — pass the deployment origin and an ingest key.
 *
 * ```ts
 * transports: [observeTransport({ url: 'https://observe.app.com', key })]              // relay (server)
 * transports: [observeTransport({ url: 'https://observe.app.com', key, client: true })] // direct
 * ```
 */
export function observeTransport(options: Omit<ObserveTransportConfig, 'type'>): ObserveTransportConfig {
    return { type: 'observe', ...options }
}

/**
 * In-memory capture destination for tests. Server-only. Every log batch is kept
 * in an array instead of hitting a real sink; a `name` shares that array with
 * the `nuxt-frogger/testing` helpers so a test can assert what was logged.
 *
 * ```ts
 * transports: [memoryTransport({ name: 'test' })]
 * // then, in a test: getCapturedLogs({ name: 'test' })
 * ```
 */
export function memoryTransport(options: Omit<MemoryTransportConfig, 'type'> = {}): MemoryTransportConfig {
    return { type: 'memory', ...options }
}
