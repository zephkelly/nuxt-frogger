import type { ClientLogger } from '../types/logger'
import { createFrogger } from '../../app/utils/index'

import { type ClientLoggerOptions } from '../types/logger'


/**
 * Composable to access the Frogger logger from any component
 */
export function useFrogger(options?: ClientLoggerOptions): ClientLogger {
    const isServer = import.meta.server

    const logger = createFrogger({
        captureConsole: true,
        captureErrors: true,
        level: 3,
        
        ...options,
        maxBatchSize: 10,
        maxBatchAge: 3000,
        maxQueueSize: 100,
    });


    return logger;
}