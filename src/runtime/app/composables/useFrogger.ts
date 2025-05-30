import type { ClientLogger } from '../types/logger'
import { createFrogger } from '../../app/utils/index'

import { type ClientLoggerOptions } from '../types/logger'


/**
 * Composable to access the Frogger logger from any component
 */
export function useFrogger(): ClientLogger {
    const logger = createFrogger();


    return logger;
}