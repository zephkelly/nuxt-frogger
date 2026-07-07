import { useState, onMounted, useRuntimeConfig } from '#imports';
import { defineNuxtPlugin } from '#app';
import { LogQueueService } from "../services/log-queue";

import { APP_MOUNTED_STATE_KEY } from '../../shared/types/module-options';
import { configureInternalLog, type InternalLogLevel } from '../../shared/utils/internal-log';



export default defineNuxtPlugin((nuxtApp) => {
    const froggerConfig = useRuntimeConfig().public.frogger as { logLevel?: InternalLogLevel } | undefined;
    configureInternalLog(froggerConfig?.logLevel);

    //@ts-ignore
    const isAppMounted = useState<boolean>(APP_MOUNTED_STATE_KEY, () => false);

    nuxtApp.hook('app:mounted', () => {
        isAppMounted.value = true;
    });

    const logQueueService = new LogQueueService();
    return {
        provide: {
            logQueue: logQueueService
        }
    }
})