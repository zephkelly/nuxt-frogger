import type { StorageInterfaceOptions } from "./storage";



export interface WebsocketOptions {
    upgrade?: (request: Request) => boolean | Promise<boolean>;
    storage?: StorageInterfaceOptions;

    maxConcurrentQueries?: number;
    defaultQueryTimeout?: number;
    maxQueryResults?: number;

    route: string;
    defaultChannel?: string;
}