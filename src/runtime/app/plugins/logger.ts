import { defineNuxtPlugin } from "#imports"
import { useRuntimeConfig } from "@nuxt/kit"
import { ClientFrogger } from '../../app/utils/frogger'



export default defineNuxtPlugin((nuxtApp) => {
    const config = useRuntimeConfig()
    const options = config.frogger?.clientOptions || {}
    
    const logger = new ClientFrogger({
        endpoint: options.endpoint || '/api/_frogger/logs',
        maxBatchSize: options.maxBatchSize,
        maxBatchAge: options.maxBatchAge,
        maxQueueSize: options.maxQueueSize,
        appName: options.appName || 'nuxt-app',
        version: options.version,
        captureErrors: options.captureErrors !== false,
        captureConsole: options.captureConsole || false,
        level: config.frogger?.level || 3
    })
    
    nuxtApp.provide('frogger', logger)
    
    if (import.meta.client) {
        nuxtApp.hook('page:start', () => {
            logger.debug('Page navigation started')
        })
        
        nuxtApp.hook('page:finish', () => {
            logger.info('Page navigation complete', {
                route: window.location.pathname
            })
        })
        
        nuxtApp.hook('app:error', (error) => {
            logger.error('App error', error)
        })
    }
    
    return {
        provide: {
            frogger: logger
        }
    }
})