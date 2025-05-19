import { ServerLogQueueService } from "../services/server-log-queue";


//@ts-ignore
export default defineNitroPlugin((nitroApp) => {
    ServerLogQueueService.getInstance()

    nitroApp.hooks.hook('close', () => {
        console.log('LogQueueService closed');
    });
});