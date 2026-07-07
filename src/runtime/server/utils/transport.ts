import { ServerLogQueueService } from '../services/server-log-queue';

import {
    HttpTransport,
    defaultHttpTransportOptions,
    type HttpTransportOptions
} from '../../logger/_transports/http-transport';
import type { IFroggerTransport } from '../../logger/_transports/types';



export function addGlobalTransport(transport: IFroggerTransport): void {
    const logQueue = ServerLogQueueService.getInstance();

    logQueue.addTransport(transport);
}


/**
 * Create an `HttpTransport` from a bare endpoint string.
 *
 * For auth, pass the options form instead and set `apiKey` — it is sent as the
 * `x-api-key` header on every batch (`headers` are merged in too).
 */
export function createHttpTransport(endpoint: string): HttpTransport;

/**
 * Create an `HttpTransport` from full options. Set `apiKey` to have Frogger send
 * it as the `x-api-key` header on every batch POST; any `headers` are merged in
 * as well.
 */
export function createHttpTransport(options: HttpTransportOptions): HttpTransport;

export function createHttpTransport(endpointOrOptions: string | HttpTransportOptions): HttpTransport {
    if (typeof endpointOrOptions === 'string') {
        const options: HttpTransportOptions = {
            ...defaultHttpTransportOptions,
            endpoint: endpointOrOptions,
        };

        return new HttpTransport(options);
    }
    else {
        return new HttpTransport(endpointOrOptions);
    }
}