import { defineNuxtPlugin } from "#app";
import { OUTER_HTML_MAX_CHARS } from '../../shared/types/global-error'
import { normaliseException } from '../../shared/utils/exception'
import { useFroggerConfig } from "../../shared/utils/use-frogger-config";
import { useFrogger } from "../composables/useFrogger";

import { H3Error } from "h3";

import type { GlobalErrorCaptureOptions } from "../../shared/types/global-error";


/**
 * Rendered markup is rendered user data and has no natural size bound. An
 * untruncated blob can also push a single row past the 1 MiB ingest cap, whose
 * 413 the client queue treats as "drop the whole queue" - so one oversized
 * error would take every buffered log with it.
 */
function truncateHtml(html: unknown): string | null {
    if (typeof html !== 'string' || html.length === 0) return null;
    if (html.length <= OUTER_HTML_MAX_CHARS) return html;
    return html.slice(0, OUTER_HTML_MAX_CHARS) + '…[truncated]';
}

export default defineNuxtPlugin((nuxtApp) => {
    const config = useFroggerConfig();

    nuxtApp.vueApp.config.errorHandler = (error, instance, info) => {
        const globalLogger = useFrogger();

        const globalErrorCaptureConfig = config.errorCapture as GlobalErrorCaptureOptions['client'] | boolean;

        if (!globalErrorCaptureConfig) {
            return;
        }

        let componentInformation: {
            name?: string;
            props?: Record<string, any>;
            outerHTML?: string | null;
        } | undefined = undefined;

        if (typeof globalErrorCaptureConfig === 'object') {
            componentInformation = {};

            if (globalErrorCaptureConfig.includeComponent && instance) {
                componentInformation.name = instance?.$.type?.__name || undefined;

                if (globalErrorCaptureConfig.includeComponentOuterHTML && instance?.$el) {
                    componentInformation.outerHTML = truncateHtml(instance.$el.outerHTML);
                }

                if (globalErrorCaptureConfig.includeComponentProps) {
                    componentInformation.props = instance?.$props || {};
                }

                if (globalErrorCaptureConfig.includeInfo) {
                    componentInformation.props = {
                        ...componentInformation.props,
                        info,
                    };
                }
            }
        }
        else if (globalErrorCaptureConfig === true) {
            // A bare `true` means "capture errors", not "capture everything
            // inside the component". Props and rendered markup are opt-in on
            // this path too, matching the resolved defaults.
            componentInformation = {
                name: instance?.$.type?.__name,
            };
        }

        // Browser stacks are minified at capture time, so the fingerprint
        // deliberately omits the stack frame: keying on a chunk hash would
        // split one error into a new group on every deploy.
        const { exception, mechanism } = normaliseException(error, {
            mechanism: 'vue-errorHandler',
            escaped: true,
            includeStack: typeof globalErrorCaptureConfig === 'object' && globalErrorCaptureConfig.includeStack,
            serverOrigin: false,
        });

        if (error instanceof Error) {
            globalLogger.error(error.message, {
                exception,
                mechanism,
                component: componentInformation,
                info: (typeof globalErrorCaptureConfig === 'object' && globalErrorCaptureConfig.includeInfo) ? info : undefined,
                stack: (typeof globalErrorCaptureConfig === 'object' && globalErrorCaptureConfig.includeStack) ? error.stack : undefined,
                uncaught: true,
            });
        }
        else if (error instanceof H3Error) {
            globalLogger.error(error.message, {
                exception,
                mechanism,
                statusCode: error.statusCode,
                data: error.data,
                component: componentInformation,
                info: info,
                uncaught: true,
            });
        }
        else {
            globalLogger.error("An unknown error occurred", {
                error: error,
                component: componentInformation,
                info: (typeof globalErrorCaptureConfig === 'object' && globalErrorCaptureConfig.includeInfo) ? info : undefined,
                uncaught: true,
            });
        }
    }
})