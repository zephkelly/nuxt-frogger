import { inject } from 'vue'
import type { Frogger } from '../../shared/types/frogger'



/**
 * Composable to access the Frogger logger from any component
 */
export function useFrogger(): Frogger {
    const logger = inject<Frogger>('frogger')
    
    if (logger) {
        return logger
    }

    console.warn('Frogger logger not found in current context')
    
    return {
        fatal: (message: any, ...args: any[]) => console.error('[FATAL]', message, ...args),
        error: (message: any, ...args: any[]) => console.error('[ERROR]', message, ...args),
        warn: (message: any, ...args: any[]) => console.warn('[WARN]', message, ...args),
        info: (message: any, ...args: any[]) => console.info('[INFO]', message, ...args),
        debug: (message: any, ...args: any[]) => console.debug('[DEBUG]', message, ...args),
        trace: (message: any, ...args: any[]) => console.trace('[TRACE]', message, ...args),
        addContext: () => {},
        setUser: () => {},
        setSession: () => {},
        startSpan: () => ({ end: () => {}, context: { traceId: '', spanId: '' } }),
        getLevel: () => 3,
        setLevel: () => {}
    }
}