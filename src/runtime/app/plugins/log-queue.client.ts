import { defineNuxtPlugin } from "#app";
import { LogQueueService } from "../services/log-queue";



const logQueueService = new LogQueueService();

export default defineNuxtPlugin(() => {
    return {
        provide: {
            logQueue: logQueueService
        }
    }
})