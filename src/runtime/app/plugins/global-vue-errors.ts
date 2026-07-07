import { defineNuxtPlugin } from "#app";
import { useRuntimeConfig } from "#imports";
import { useFrogger } from "../composables/useFrogger";

import { H3Error } from "h3";

import type { GlobalErrorCaptureOptions } from "../../shared/types/global-error";


export default defineNuxtPlugin((nuxtApp) => {
    const config = useRuntimeConfig();

    nuxtApp.vueApp.config.errorHandler = (error, instance, info) => {
        const globalLogger = useFrogger();

        //@ts-ignore
        const globalErrorCaptureConfig = config.public.frogger.errorCapture as GlobalErrorCaptureOptions['client'] | boolean;

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
                    componentInformation.outerHTML = instance.$el.outerHTML || null;
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
            componentInformation = {
                name: instance?.$.type?.__name,
                props: instance?.$props || {},
                outerHTML: instance?.$el?.outerHTML || null,
            };
        }

        if (error instanceof Error) {
            globalLogger.error(error.message, {
                component: componentInformation,
                info: (typeof globalErrorCaptureConfig === 'object' && globalErrorCaptureConfig.includeInfo) ? info : undefined,
                stack: (typeof globalErrorCaptureConfig === 'object' && globalErrorCaptureConfig.includeStack) ? error.stack : undefined,
                uncaught: true,
            });
        }
        else if (error instanceof H3Error) {
            globalLogger.error(error.message, {
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