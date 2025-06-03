import type { LogObject } from 'consola/basic';
import { BaseFroggerLogger } from '../../shared/utils/base-frogger';
import type { LoggerObject } from '../../shared/types/log';
import type { TraceContext } from '../../shared/types/trace-headers';
import { Writable } from 'node:stream';

export interface TestFroggerLoggerOptions {
  level?: number;
  stream?: Writable;
  format?: 'json' | 'compact' | 'raw';
}

/**
 * TestFroggerLogger - A high-performance logger designed specifically for benchmarking
 * 
 * This logger is designed to be a drop-in replacement for other loggers in benchmark tests.
 * It writes directly to a stream (like /dev/null) without any batching, queuing, or async overhead.
 * 
 * Usage example (matching Pino benchmark pattern):
 * ```
 * const fs = require('node:fs')
 * const dest = fs.createWriteStream('/dev/null')
 * const frogger = new TestFroggerLogger({ stream: dest })
 * 
 * // Use exactly like other loggers in benchmark
 * frogger.info('hello world')
 * ```
 */
export class TestFroggerLogger extends BaseFroggerLogger {
    private stream: Writable;
    private format: 'json' | 'compact' | 'raw';
    private traceContext: TraceContext | null = null;

    constructor(options: TestFroggerLoggerOptions = {}) {
        super({ 
            level: options.level ?? 3, 
            consoleOutput: false
        });
        
        this.stream = options.stream ?? process.stdout;
        this.format = options.format ?? 'json';
    }

    static create(stream?: Writable): TestFroggerLogger {
        return new TestFroggerLogger({ stream });
    }

    static destination(dest: string | Writable): TestFroggerLogger {
        if (typeof dest === 'string') {
            const fs = require('node:fs');
            const stream = fs.createWriteStream(dest);
            return new TestFroggerLogger({ stream });
        }

        return new TestFroggerLogger({ stream: dest });
    }

    protected createLoggerObject(logObj: LogObject): LoggerObject {
        if (!logObj || typeof logObj !== 'object') {
            throw new Error('Invalid log object provided');
        }

        const currentTraceContext = this.generateTraceContext();

        return {
            time: logObj.date.getTime(),
            lvl: logObj.level,
            msg: logObj.args?.[0],
            ctx: {
                env: 'test',
                type: logObj.type,
                ...this.globalContext,
                ...logObj.args?.slice(1)[0],
            },
            trace: currentTraceContext,
        };
    }

    protected processLoggerObject(loggerObject: LoggerObject): void {
        const serialized = this.serializeLoggerObject(loggerObject);
        this.stream.write(serialized + '\n');
    }


    private serializeLoggerObject(loggerObject: LoggerObject): string {
        switch (this.format) {
        case 'json':
            return JSON.stringify(loggerObject);
        
        default:
            return JSON.stringify(loggerObject);
        }
    }

    setFormat(format: 'json' | 'compact' | 'raw'): void {
        this.format = format;
    }

    async flush(): Promise<void> {
        return Promise.resolve();
    }

    getStream(): Writable {
        return this.stream;
    }
}