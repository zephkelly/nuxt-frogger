import { ClientFrogger } from '../../app/utils/frogger';
import { ServerFrogger } from '../../server/utils/frogger';
import type { ClientLoggerOptions } from '../../app/types/logger';
import type { ServerLoggerOptions } from '../../server/types/logger';

import type { Frogger } from '../types/frogger';



/**
 * Factory function to create the appropriate Frogger instance
 * based on environment
 */
export function createFrogger(options: ClientLoggerOptions | ServerLoggerOptions = {}): Frogger {
    // Detect environment
    const isServer = typeof window === 'undefined';
    
    if (isServer) {
        return new ServerFrogger(options as ServerLoggerOptions);
    } else {
        return new ClientFrogger(options as ClientLoggerOptions);
    }
}

/**
 * Export a default logger instance for direct import
 * This provides the simplest API for users
 */
export const frogger: Frogger = createFrogger();