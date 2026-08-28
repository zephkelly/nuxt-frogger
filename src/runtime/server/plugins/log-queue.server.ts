import { ServerLogQueueService } from "../services/server-log-queue";

//@ts-ignore
import { defineNitroPlugin } from '#imports';
import { useFroggerServerConfig } from '../../shared/utils/use-frogger-config';
import { configureInternalLog, type InternalLogLevel } from "../../shared/utils/internal-log";


//@ts-ignore
export default defineNitroPlugin((nitroApp) => {
    const froggerConfig = useFroggerServerConfig();
    configureInternalLog(froggerConfig?.logLevel);

    const queue = ServerLogQueueService.getInstance()

    // Graceful shutdown: empty the batch buffer (sorting window included)
    // before Nitro lets the process go.
    nitroApp.hooks.hook('close', async () => {
        await queue.drain()
    });
});