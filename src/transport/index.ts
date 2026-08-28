/**
 * The public transport contract: `nuxt-frogger/transport`.
 *
 * A transport is a destination for log records. Everything Frogger ships (file,
 * stdout, HTTP, memory, websocket) implements the same interface, and so can
 * anything you write - the pieces were already stable, they were just not
 * exported, so a user-authored destination had to reach into `dist/runtime`.
 *
 * ```ts
 * // server/plugins/my-sink.ts
 * import { BaseTransport, addGlobalTransport } from 'nuxt-frogger/transport'
 * import type { LoggerObject } from 'nuxt-frogger/transport'
 *
 * class ClickHouseTransport extends BaseTransport {
 *   readonly name = 'clickhouse'
 *   readonly transportId = 'clickhouse-1'
 *   protected options = {}
 *
 *   async log(row: LoggerObject) {
 *     await this.logBatch([row])
 *   }
 *
 *   override async logBatch(rows: LoggerObject[]) {
 *     await insertRows(rows)
 *   }
 * }
 *
 * export default defineNitroPlugin(() => {
 *   addGlobalTransport(new ClickHouseTransport())
 * })
 * ```
 *
 * The contract:
 *
 * - `log` / `logBatch` receive records that already passed the logger's level
 *   gate, the scrubber and any `minLevel` on this destination.
 * - Neither may throw INTO the caller. The queue isolates each transport, but a
 *   throwing transport still costs the batch its delivery - catch and degrade.
 * - Both must stay cheap. They run on the request path when batching is off,
 *   and on the flush path when it is on. Do network work asynchronously.
 * - `flush()` is the polite runtime flush; `forceFlush()` is the shutdown
 *   drain, called from Nitro's `close` hook, and must empty buffers.
 * - `destroy()` releases resources. Nothing is called after it.
 */

export type { IFroggerTransport } from '../runtime/logger/_transports/types'
export type { LoggerObject, LogContext } from '../runtime/shared/types/log'
export type { LoggerObjectBatch } from '../runtime/shared/types/batch'
export type { FroggerResource } from '../runtime/shared/types/resource'
export type { TraceContext } from '../runtime/shared/types/trace-headers'

export { BaseTransport } from '../runtime/logger/_transports/base-transport'
export { withMinLevel } from '../runtime/logger/_transports/level-gate'

export { HttpTransport } from '../runtime/logger/_transports/http-transport'
export type { HttpTransportOptions } from '../runtime/logger/_transports/http-transport'
export { StdoutTransport } from '../runtime/logger/_transports/stdout-transport'
export type { StdoutTransportOptions } from '../runtime/logger/_transports/stdout-transport'
export { MemoryTransport, getMemoryStore, clearMemoryStore } from '../runtime/logger/_transports/memory-transport'
export { FileTransport } from '../runtime/logger/_transports/file-transport'

export { addGlobalTransport, createHttpTransport } from '../runtime/server/utils/transport'

export { getFroggerHealth } from '../runtime/shared/utils/health'
export type { FroggerHealth, FroggerDropCounts } from '../runtime/shared/utils/health'
