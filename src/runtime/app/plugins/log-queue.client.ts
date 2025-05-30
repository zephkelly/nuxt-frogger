import { defineNuxtPlugin } from "#app";
import { LogQueueService } from "../services/log-queue";




export default defineNuxtPlugin(() => {
    const logQueueService = new LogQueueService();
    return {
        provide: {
            logQueue: logQueueService
        }
    }
})