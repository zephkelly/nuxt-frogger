import { BaseTransport } from './base-transport';

import type { LoggerObject } from '../../shared/types/log';
import { uuidv7 } from '../../shared/utils/uuid';
import { froggerInternal } from '../../shared/utils/internal-log';

export interface StdoutTransportOptions {
    /** Registry label for diagnostics. @default 'stdout' */
    name?: string;
}

/**
 * JSON-lines to file descriptor 1.
 *
 * The one persistent sink that needs no user infrastructure and works on every
 * Nitro preset, edge included: Vector, Fluent Bit, Promtail, Docker and every
 * platform's own log view already read stdout. It is the honest answer to "I
 * want my logs somewhere durable" for a deployment with no writable disk, which
 * is exactly where `fileTransport()` cannot go.
 *
 * Deliberately not the console reporter: that is human-formatted output for the
 * developer watching a terminal. This is machine-readable output for a
 * collector, and the two have different consumers and different formats.
 */
export class StdoutTransport extends BaseTransport<Required<StdoutTransportOptions>> {
    public readonly name = 'FroggerStdoutTransport';
    public readonly transportId: string;

    protected options: Required<StdoutTransportOptions>;

    constructor(options: StdoutTransportOptions = {}) {
        super();
        this.transportId = `frogger-stdout-${uuidv7()}`;
        this.options = { name: options.name ?? 'stdout' };
    }

    log(logObj: LoggerObject): void {
        this.write(JSON.stringify(logObj) + '\n');
    }

    override logBatch(logs: LoggerObject[]): void {
        if (logs.length === 0) return;

        // One write for the whole batch: a per-row write on a pipe is a syscall
        // per row, which is the difference between a sink you can leave on and
        // one you notice.
        this.write(logs.map(log => JSON.stringify(log)).join('\n') + '\n');
    }

    private write(payload: string): void {
        try {
            // `process.stdout.write` where available (Node, Bun, Deno); a
            // plain `console.log` on a runtime without it, which still reaches
            // the platform's log collector.
            const stdout = (globalThis as { process?: { stdout?: { write?: (s: string) => boolean } } })
                .process?.stdout;

            if (stdout?.write) {
                stdout.write(payload);
                return;
            }

            // eslint-disable-next-line no-console
            console.log(payload.trimEnd());
        }
        catch (err) {
            froggerInternal.error('StdoutTransport: failed to write:', err);
        }
    }
}
