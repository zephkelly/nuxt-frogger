import { ServerLogQueueService } from "../services/server-log-queue";

//@ts-ignore
import { defineNitroPlugin } from '#imports';


//@ts-ignore
export default defineNitroPlugin((nitroApp) => {
    ServerLogQueueService.getInstance()
});