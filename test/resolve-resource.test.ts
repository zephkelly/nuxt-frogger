import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { resolveBuildResource, getServerResource, resetServerResource } from '../src/runtime/shared/utils/resolve-resource'
import { RESOURCE_ENV_KEYS } from '../src/runtime/shared/types/resource'

const ENV_KEYS = Object.values(RESOURCE_ENV_KEYS)

describe('resolveBuildResource', () => {
    beforeEach(() => {
        for (const key of ENV_KEYS) delete process.env[key]
        resetServerResource()
    })

    afterEach(() => {
        for (const key of ENV_KEYS) delete process.env[key]
        resetServerResource()
    })

    it('defaults the environment from the dev flag', () => {
        expect(resolveBuildResource({ dev: true })['deployment.environment']).toBe('development')
        expect(resolveBuildResource({ dev: false })['deployment.environment']).toBe('production')
    })

    it('prefers an explicit option over the dev default', () => {
        const resource = resolveBuildResource({ dev: true, environment: 'staging' })
        expect(resource['deployment.environment']).toBe('staging')
    })

    it('falls back to the env var when no option is set', () => {
        process.env[RESOURCE_ENV_KEYS.environment] = 'preview'
        expect(resolveBuildResource({ dev: false })['deployment.environment']).toBe('preview')
    })

    it('carries app name and version onto OTel resource keys', () => {
        const resource = resolveBuildResource({ dev: false, appName: 'shop', appVersion: '2.1.0' })
        expect(resource['service.name']).toBe('shop')
        expect(resource['service.version']).toBe('2.1.0')
        // release defaults to the version so a reader always has one axis to
        // answer "did this start after the last deploy".
        expect(resource['service.release']).toBe('2.1.0')
    })

    it('omits keys it has no value for rather than emitting empty strings', () => {
        expect(resolveBuildResource({ dev: false })).toEqual({ 'deployment.environment': 'production' })
    })

    it('leaves service.instance.id to the runtime, not the build', () => {
        expect(resolveBuildResource({ dev: false })['service.instance.id']).toBeUndefined()
    })
})

describe('getServerResource', () => {
    beforeEach(() => {
        for (const key of ENV_KEYS) delete process.env[key]
        resetServerResource()
    })

    afterEach(() => {
        for (const key of ENV_KEYS) delete process.env[key]
        resetServerResource()
    })

    it('adds a per-process instance id and memoises it', () => {
        const first = getServerResource({ 'service.name': 'shop' })
        const second = getServerResource({ 'service.name': 'shop' })

        expect(first['service.instance.id']).toBeTruthy()
        expect(second['service.instance.id']).toBe(first['service.instance.id'])
    })

    it('honours an explicit instance id from the host', () => {
        process.env[RESOURCE_ENV_KEYS.instanceId] = 'node-3'
        expect(getServerResource({})['service.instance.id']).toBe('node-3')
    })

    it('re-reads environment and release at boot so one build can be promoted', () => {
        process.env[RESOURCE_ENV_KEYS.environment] = 'staging'
        process.env[RESOURCE_ENV_KEYS.release] = 'sha-abc123'

        const resource = getServerResource({
            'deployment.environment': 'production',
            'service.release': '1.0.0',
        })

        expect(resource['deployment.environment']).toBe('staging')
        expect(resource['service.release']).toBe('sha-abc123')
    })
})
