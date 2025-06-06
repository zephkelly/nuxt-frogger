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

    private safeClone(obj: any, maxDepth: number = 10, currentDepth: number = 0): any {
        if (currentDepth > maxDepth) {
            return '[MAX_DEPTH_EXCEEDED]';
        }

        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        if (obj instanceof Date) {
            return new Date(obj.getTime());
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.safeClone(item, maxDepth, currentDepth + 1));
        }

        const seen = new WeakSet();
        
        const cloneWithCircularCheck = (source: any, depth: number): any => {
            if (depth > maxDepth) {
                return '[MAX_DEPTH_EXCEEDED]';
            }

            if (source === null || typeof source !== 'object') {
                return source;
            }

            if (seen.has(source)) {
                return '[CIRCULAR_REFERENCE]';
            }

            seen.add(source);

            if (Array.isArray(source)) {
                const result = source.map(item => cloneWithCircularCheck(item, depth + 1));
                seen.delete(source);
                return result;
            }

            const result: any = {};
            for (const [key, value] of Object.entries(source)) {
                result[key] = cloneWithCircularCheck(value, depth + 1);
            }
            seen.delete(source);
            return result;
        };

        return cloneWithCircularCheck(obj, currentDepth);
    }

    protected createLoggerObject(logObj: LogObject): LoggerObject {
        const timestamp = new Date().getTime();
        const traceContext = this.generateTraceContext();
        
        let context = {};
        if (logObj.args && logObj.args.length > 1) {
            const contextArg = logObj.args[1];
            if (contextArg && typeof contextArg === 'object') {
                context = this.safeClone(contextArg);
            }
        }

        // Merge with global context
        const mergedContext = {
            ...this.globalContext,
            ...context
        };

        return {
            lvl: logObj.level,
            time: timestamp,
            msg: logObj.args?.[0] || '',
            ctx: mergedContext,
            trace: traceContext
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