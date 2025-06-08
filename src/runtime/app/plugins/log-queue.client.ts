// import { useState, onMounted } from '#imports';
import { defineNuxtPlugin } from '#app';
import { LogQueueService } from "../services/log-queue";

import { APP_MOUNTED_STATE_KEY } from '../../shared/types/module-options';



export default defineNuxtPlugin((nuxtApp) => {
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