import { defineNuxtPlugin, useRuntimeConfig } from "#app";
import { useFrogger } from "../composables/useFrogger";

import { H3Error } from "h3";


export default defineNuxtPlugin((nuxtApp) => {
    const config = useRuntimeConfig();

    nuxtApp.vueApp.config.errorHandler = (error, instance, info) => {
        const globalLogger = useFrogger();

        //@ts-expect-error
        const globalErrorCaptureConfig = config.public.frogger.globalErrorCapture;

        if (!globalErrorCaptureConfig || globalErrorCaptureConfig === false) {
            return;
        }

        let componentInformation: {
            name?: string;
            props?: Record<string, any>;
            outerHTML?: string | null;
        } | undefined = undefined;

        if (typeof globalErrorCaptureConfig === 'object') {
            componentInformation = {};

            //@ts-ignore
            if (globalErrorCaptureConfig.includeComponent && instance) {
                componentInformation.name = instance?.$.type?.__name || undefined;
               
                //@ts-ignore
                if (globalErrorCaptureConfig.includeComponentOuterHTML && instance?.$el) {
                    componentInformation.outerHTML = instance.$el.outerHTML || null;
                }

                //@ts-ignore
                if (globalErrorCaptureConfig.includeComponentProps) {
                    componentInformation.props = instance?.$props || {};
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
                info: globalErrorCaptureConfig.includeInfo ? info : undefined,
                stack: globalErrorCaptureConfig.includeStack ? error.stack : undefined,
                global: true,
            });
        }
        else if (error instanceof H3Error) {
            globalLogger.error(error.message, {
                statusCode: error.statusCode,
                data: error.data,
                component: componentInformation,
                info: info,
                global: true,
            });
        }
        else {
            globalLogger.error("An unknown error occurred", {
                error: error,
                component: componentInformation,
                info: globalErrorCaptureConfig.includeInfo ? info : undefined,
                global: true,
            });
        }
    }
})