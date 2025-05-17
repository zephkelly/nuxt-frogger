import type { Frogger } from '../../shared/types/frogger'
import { createFrogger } from '../../app/utils/index'

import { type ClientLoggerOptions } from '../types/logger'


/**
 * Composable to access the Frogger logger from any component
 */
export function useFrogger(options: ClientLoggerOptions): Frogger {
    const isServer = import.meta.server

    const logger = createFrogger({
        captureConsole: true,
        captureErrors: true,
        level: 3,

        appName: isServer ? 'nuxt-client-ssr' : 'nuxt-client',
    });


    return logger;
}