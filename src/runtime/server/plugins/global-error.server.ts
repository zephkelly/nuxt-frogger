//@ts-ignore
import { defineNitroPlugin } from "#imports";
import { useFroggerServerConfig } from "../../shared/utils/use-frogger-config";
import { H3Error } from "h3";
import { getFrogger } from "../utils/get-frogger";
import { ServerLogQueueService } from "../services/server-log-queue";
import { isErrorLogged } from "../../shared/utils/normalize-errors";
import { normaliseException } from "../../shared/utils/exception";
import type { ExceptionMechanism } from "../../shared/utils/exception";
import type { GlobalErrorCaptureOptions } from "../../shared/types/global-error";
import { DENIED_HEADERS } from "../../shared/types/global-error";

/**
 * Push buffered logs out before the process dies. The 50ms lead gives the
 * in-flight consola pipeline (async reporter hop) time to enqueue the crash
 * line itself; the race caps how long shutdown can hang on a dead transport.
 */
async function drainBeforeExit(timeoutMs: number): Promise<void> {
    try {
        await new Promise(resolve => setTimeout(resolve, 50));
        await Promise.race([
            ServerLogQueueService.getInstance().drain(),
            new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
        ]);
    }
    catch {
        // Exiting anyway; a drain failure must never mask the real crash.
    }
}

/**
 * Request headers safe to attach to an error report.
 *
 * Two problems this solves. First, `event.headers` is a `Headers` instance:
 * the scrubber walks values with `Object.entries`, which returns `[]` for
 * `Headers`, so it was emitted by reference and completely unredacted.
 * Second, no rule list covered `cookie` or `authorization` in the first place,
 * so even a working traversal would have shipped them.
 *
 * The deny-list applies unconditionally - it is not a scrub rule the user can
 * accidentally configure away.
 */
function safeHeaders(
    headers: unknown,
    include: boolean | string[] | undefined,
): Record<string, string> | undefined {
    if (!include) return undefined;

    const entries: [string, string][] = [];

    if (headers instanceof Headers) {
        for (const [key, value] of headers.entries()) entries.push([key, value]);
    }
    else if (headers && typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
            if (typeof value === 'string') entries.push([key, value]);
            else if (Array.isArray(value)) entries.push([key, value.join(', ')]);
        }
    }
    else {
        return undefined;
    }

    const allowList = Array.isArray(include)
        ? new Set(include.map(h => h.toLowerCase()))
        : null;

    const result: Record<string, string> = {};
    for (const [rawKey, value] of entries) {
        const key = rawKey.toLowerCase();
        if (allowList && !allowList.has(key)) continue;
        result[key] = DENIED_HEADERS.includes(key) ? '[redacted]' : value;
    }

    return result;
}

//@ts-ignore
export default defineNitroPlugin((nitroApp) => {
    const globalErrorCaptureConfig = useFroggerServerConfig().errorCapture;

    if (!globalErrorCaptureConfig) {
        return;
    }

    const globalLogger = getFrogger({
        context: {
            errorHandler: 'global',
        }
    });

    const drainTimeoutMs = globalErrorCaptureConfig.drainTimeoutMs ?? 3000;

    /**
     * The normalised `exception` / `mechanism` pair every capture site emits,
     * ALONGSIDE its existing flat keys. The flat keys cost nothing to keep and
     * removing them would break readers written against the old four shapes.
     */
    const shaped = (error: unknown, mechanism: ExceptionMechanism, escaped: boolean) =>
        normaliseException(error, {
            mechanism,
            escaped,
            includeStack: globalErrorCaptureConfig.includeStack !== false,
            serverOrigin: true,
        });

    process.on('uncaughtException', (error: Error, origin: string) => {
        const { exception, mechanism } = shaped(error, 'uncaught-exception', true);

        globalLogger.fatal('Uncaught Exception', {
            exception,
            mechanism,
            message: error.message,
            stack: globalErrorCaptureConfig.includeStack !== false ? error.stack : undefined,
            origin,
            uncaught: true,
            name: error.name,
            cause: error.cause,
        });

        // Log and drain, but do NOT decide the process's fate. Whether an
        // uncaught exception is fatal is the host's call; a logger forcing
        // exit(1) removes that choice.
        const draining = drainBeforeExit(drainTimeoutMs);

        if (globalErrorCaptureConfig.exitOnUncaught) {
            void draining.finally(() => {
                process.exit(1);
            });
        }
    });

    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
        const { exception, mechanism } = shaped(reason, 'unhandledrejection', true);

        const errorInfo: Record<string, any> = {
            exception,
            mechanism,
            uncaught: true,
            type: 'unhandledRejection',
        };

        if (reason instanceof Error) {
            errorInfo.message = reason.message;
            errorInfo.name = reason.name;
            errorInfo.stack = globalErrorCaptureConfig.includeStack !== false ? reason.stack : undefined;
            errorInfo.cause = reason.cause;
        } else if (reason instanceof H3Error) {
            errorInfo.message = reason.message;
            errorInfo.statusCode = reason.statusCode;
            errorInfo.statusMessage = reason.statusMessage;
            errorInfo.data = reason.data;
        } else {
            errorInfo.reason = String(reason);
        }

        globalLogger.error('Unhandled Promise Rejection', errorInfo);
    });

    process.on('rejectionHandled', (promise: Promise<any>) => {
        if (globalErrorCaptureConfig.includeRejectionHandled) {
            globalLogger.warn('Promise rejection handled after event loop turn', {
                type: 'rejectionHandled',
            });
        }
    });

    process.on('warning', (warning: Error) => {
        if (globalErrorCaptureConfig.includeWarnings) {
            globalLogger.warn('Process Warning', {
                name: warning.name,
                message: warning.message,
                stack: globalErrorCaptureConfig.includeStack !== false ? warning.stack : undefined,
            });
        }
    });

    //@ts-ignore
    nitroApp.hooks.hook('error', (error, { event }) => {
        // An error a handler already caught and logged (any Error serialised
        // into a log row is stamped) is not reported a second time here.
        if (globalErrorCaptureConfig.dedupe !== false
            && (isErrorLogged(error) || (error instanceof Error && isErrorLogged(error.cause)))) {
            return;
        }

        const { exception, mechanism } = shaped(error, 'nitro-error-hook', true);

        const errorContext: Record<string, any> = {
            exception,
            mechanism,
            uncaught: true,
            type: 'nitro-error',
        };

        if (event && globalErrorCaptureConfig.includeRequestContext) {
            errorContext.request = {
                method: event.method,
                url: event.path,
                headers: safeHeaders(event.headers, globalErrorCaptureConfig.includeHeaders),
            };
        }

        if (error instanceof H3Error) {
            globalLogger.error(error.message, {
                ...errorContext,
                statusCode: error.statusCode,
                statusMessage: error.statusMessage,
                data: error.data,
                stack: globalErrorCaptureConfig.includeStack !== false ? error.stack : undefined,
            });
        } else if (error instanceof Error) {
            globalLogger.error(error.message, {
                ...errorContext,
                name: error.name,
                stack: globalErrorCaptureConfig.includeStack !== false ? error.stack : undefined,
                cause: error.cause,
            });
        } else {
            globalLogger.error('Unknown error in Nitro', {
                ...errorContext,
                error: String(error),
            });
        }
    });

    // `beforeExit` is a passive drain: it runs when the event loop empties on
    // its own and never forces an exit. The active path is Nitro's `close`
    // hook, wired in log-queue.server.ts, which is what a normal deploy uses.
    process.on('beforeExit', () => {
        void ServerLogQueueService.getInstance().drain().catch(() => {});
    });

    // Owning SIGTERM/SIGINT is opt-in. By default the platform's shutdown
    // sequence runs untouched: on a rolling deploy SIGTERM means "finish your
    // in-flight requests", and a logger exiting a few seconds later truncates
    // them along with every other handler the app registered.
    //
    // Serverless and edge deployments should use their platform's `waitUntil`
    // equivalent rather than either path.
    if (globalErrorCaptureConfig.takeoverSignals) {
        for (const signal of ['SIGTERM', 'SIGINT'] as const) {
            process.on(signal, async () => {
                globalLogger.info(`Received ${signal}, starting graceful shutdown`);

                await drainBeforeExit(drainTimeoutMs);

                process.exit(0);
            });
        }
    }
});