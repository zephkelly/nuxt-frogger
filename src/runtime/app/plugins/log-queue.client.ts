import { defineNuxtPlugin } from "#app";
import { LogQueueService } from "../services/log-queue";



const logQueueService = new LogQueueService();

export default defineNuxtPlugin(() => {
    console.log('LogQueueService initialised');
    return {
        provide: {
            logQueue: logQueueService
        }
    }
})