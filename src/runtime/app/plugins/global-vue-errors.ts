import { defineNuxtPlugin } from "#app";
import { useFrogger } from "../composables/useFrogger";

import { H3Error } from "h3";


export default defineNuxtPlugin((nuxtApp) => {
    nuxtApp.vueApp.config.errorHandler = (error, instance, info) => {
        const globalLogger = useFrogger();

        const componentInformation = {
            name: instance?.$.type?.__name,
            props: instance?.$attrs || {},
            outerHTML: instance?.$el.outerHTML || null,
        }

        if (error instanceof Error) {
            globalLogger.error(error.message, {
                component: componentInformation,
                info: info,
                stack: error.stack,
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
                info: info,
                global: true,
            });
        }
    }
})