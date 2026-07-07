import { ServerLogQueueService } from "../services/server-log-queue";

//@ts-ignore
import { defineNitroPlugin, useRuntimeConfig } from '#imports';
import { configureInternalLog, type InternalLogLevel } from "../../shared/utils/internal-log";


//@ts-ignore
export default defineNitroPlugin((nitroApp) => {
    const froggerConfig = useRuntimeConfig().frogger as { logLevel?: InternalLogLevel } | undefined;
    configureInternalLog(froggerConfig?.logLevel);

    ServerLogQueueService.getInstance()
});