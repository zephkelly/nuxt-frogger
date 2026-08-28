export interface WebsocketOptions {
    route: string;
    defaultChannel?: string;

    upgrade?: (request: Request) => boolean | Promise<boolean>;
}
