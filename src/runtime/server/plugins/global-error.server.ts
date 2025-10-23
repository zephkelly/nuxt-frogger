//@ts-ignore
import { defineNitroPlugin } from "#imports";
import { H3Error } from "h3";
import { getFrogger } from "../utils/auto";

//@ts-ignore
export default defineNitroPlugin((nitroApp) => {
    const config = useRuntimeConfig();

    //@ts-ignore
    const globalErrorCaptureConfig = config.frogger?.errorCapture;

    if (!globalErrorCaptureConfig || globalErrorCaptureConfig === false) {
        return;
    }

    const globalLogger = getFrogger({
        context: {
            errorHandler: 'global',
        }
    });

    process.on('uncaughtException', (error: Error, origin: string) => {
        globalLogger.fatal('Uncaught Exception', {
            message: error.message,
            stack: globalErrorCaptureConfig.includeStack !== false ? error.stack : undefined,
            origin,
            uncaught: true,
            name: error.name,
            cause: error.cause,
        });

        setTimeout(() => {
            process.exit(1);
        }, 1000);
    });

    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
        const errorInfo: Record<string, any> = {
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
        const errorContext: Record<string, any> = {
            uncaught: true,
            type: 'nitro-error',
        };

        if (event && globalErrorCaptureConfig.includeRequestContext) {
            errorContext.request = {
                method: event.method,
                url: event.path,
                headers: globalErrorCaptureConfig.includeHeaders ? event.headers : undefined,
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

    const shutdownSignals = ['SIGTERM', 'SIGINT'];
    shutdownSignals.forEach((signal) => {
        process.on(signal, async () => {
            globalLogger.info(`Received ${signal}, starting graceful shutdown`);

            await new Promise(resolve => setTimeout(resolve, 500));

            process.exit(0);
        });
    });
});