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


export function createHttpTransport(endpoint: string): HttpTransport;

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