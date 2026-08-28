import { uuidv7 } from '../../shared/utils/uuid';

import { BaseTransport } from './base-transport';

import type { LoggerObject } from '../../shared/types/log';



/**
 * Process-global registry of captured-log arrays, keyed by transport `name`.
 *
 * This is the bridge the hybrid memory API relies on: a `memoryTransport({ name })`
 * entry travels through `runtimeConfig` carrying only its `name` (arrays are not
 * serializable), the `MemoryTransport` constructed in the server queue writes
 * into `STORE.get(name)`, and the `nuxt-frogger/testing` helpers read the same
 * array back out via {@link getMemoryStore}. The store hangs off `globalThis` so
 * a single instance is shared across every module graph in the process.
 */
const STORE: Map<string, LoggerObject[]> = (
    (globalThis as unknown as { __FROGGER_MEMORY_STORE__?: Map<string, LoggerObject[]> })
        .__FROGGER_MEMORY_STORE__ ??= new Map<string, LoggerObject[]>()
);

/**
 * Get (creating if absent) the shared capture array for a named memory
 * transport. Used by `nuxt-frogger/testing` to read back what was logged.
 */
export function getMemoryStore(name: string): LoggerObject[] {
    let logs = STORE.get(name);
    if (!logs) {
        logs = [];
        STORE.set(name, logs);
    }
    return logs;
}

/**
 * Clear a single named store (mutates the array in place so any existing
 * reference keeps pointing at the now-empty capture), or every store when no
 * name is given.
 */
export function clearMemoryStore(name?: string): void {
    if (name === undefined) {
        for (const logs of STORE.values()) {
            logs.length = 0;
        }
        return;
    }
    const logs = STORE.get(name);
    if (logs) {
        logs.length = 0;
    }
}

export interface MemoryTransportOptions {
    /**
     * Registry key. When set, this transport captures into the process-global
     * store shared with `getCapturedLogs({ name })`. Unnamed instances keep a
     * private array only reachable through this instance.
     */
    name?: string;
}

/**
 * Transport that captures every log into an in-memory array instead of a real
 * sink. Server-only. Intended for tests: assert what the app logged without a
 * file or HTTP destination.
 */
export class MemoryTransport extends BaseTransport<MemoryTransportOptions> {
    public readonly name = 'FroggerMemoryTransport';
    public readonly transportId: string;

    protected options: MemoryTransportOptions;
    private logs: LoggerObject[];

    constructor(options: MemoryTransportOptions = {}) {
        super();
        this.transportId = `frogger-memory-${uuidv7()}`;
        this.options = options;

        // A named instance shares the registry array so a config-built transport
        // and a test helper see the same captures; unnamed keeps its own.
        this.logs = options.name !== undefined
            ? getMemoryStore(options.name)
            : [];
    }

    log(logObj: LoggerObject): void {
        this.logs.push(logObj);
    }

    override logBatch(logs: LoggerObject[]): void {
        for (const log of logs) {
            this.logs.push(log);
        }
    }

    /** Nothing is written asynchronously, so there is nothing to drain. */
    override async flush(): Promise<void> { }

    /** Every captured log, in insertion order. */
    getLogs(): LoggerObject[] {
        return this.logs;
    }

    /** Drop every captured log (in place, so shared references stay valid). */
    clear(): void {
        this.logs.length = 0;
    }

    get size(): number {
        return this.logs.length;
    }
}
