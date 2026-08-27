import { describe, it, expect } from 'vitest'

import { hasPrimaryLogSink } from '../src/runtime/shared/utils/primary-sink'
import { DEFAULT_LOGGING_ENDPOINT } from '../src/runtime/shared/types/module-options'

describe('hasPrimaryLogSink', () => {
    it('is false for a static app: serverModule off, default endpoint, no baseUrl', () => {
        expect(hasPrimaryLogSink({
            serverModuleEnabled: false,
            endpoint: DEFAULT_LOGGING_ENDPOINT,
            baseUrl: '',
        })).toBe(false)
    })

    it('is true for a relay app: default endpoint but baseUrl points at the ingest origin', () => {
        // The paincoach topology: four emitter apps posting to one api relay.
        // Both the old build warning and the old sendLogImmediate guard got
        // this wrong by ignoring baseUrl.
        expect(hasPrimaryLogSink({
            serverModuleEnabled: false,
            endpoint: DEFAULT_LOGGING_ENDPOINT,
            baseUrl: 'https://api.example.com',
        })).toBe(true)
    })

    it('is true for a customised endpoint even without baseUrl', () => {
        expect(hasPrimaryLogSink({
            serverModuleEnabled: false,
            endpoint: '/ingest/logs',
            baseUrl: '',
        })).toBe(true)
    })

    it('is true whenever the server module ingests locally', () => {
        expect(hasPrimaryLogSink({
            serverModuleEnabled: true,
            endpoint: DEFAULT_LOGGING_ENDPOINT,
            baseUrl: '',
        })).toBe(true)
    })

    it('is false when the endpoint is deliberately disabled, regardless of everything else', () => {
        expect(hasPrimaryLogSink({
            serverModuleEnabled: true,
            endpoint: false,
            baseUrl: 'https://api.example.com',
        })).toBe(false)
    })

    it('is false for a missing endpoint', () => {
        expect(hasPrimaryLogSink({
            serverModuleEnabled: false,
            endpoint: undefined,
            baseUrl: 'https://api.example.com',
        })).toBe(false)
    })
})
