import { describe, it, expect } from 'vitest';

import {
    fileTransport,
    httpTransport,
    observeTransport,
} from '../src/runtime/shared/transports/factories';

describe('transport factories', () => {
    it('fileTransport tags type:file and carries options', () => {
        expect(fileTransport()).toEqual({ type: 'file' });
        expect(fileTransport({ directory: 'var/log', name: 'disk' })).toEqual({
            type: 'file', directory: 'var/log', name: 'disk',
        });
    });

    it('httpTransport tags type:http and carries options', () => {
        expect(httpTransport({ url: 'https://x.dev/ingest', apiKey: 'k' })).toEqual({
            type: 'http', url: 'https://x.dev/ingest', apiKey: 'k',
        });
    });

    it('observeTransport tags type:observe and carries options', () => {
        expect(observeTransport({ url: 'https://observe.app.com', key: 'k', client: true })).toEqual({
            type: 'observe', url: 'https://observe.app.com', key: 'k', client: true,
        });
    });

    it('returns plain serializable objects that survive structuredClone', () => {
        const entries = [
            fileTransport({ directory: 'logs' }),
            httpTransport({ url: 'https://x.dev/ingest', apiKey: 'k', headers: { 'x-a': '1' } }),
            observeTransport({ url: 'https://observe.app.com', key: 'k' }),
        ];

        for (const entry of entries) {
            const cloned = structuredClone(entry);
            expect(cloned).toEqual(entry);
            expect(cloned).not.toBe(entry);
        }
    });
});
