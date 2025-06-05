import type { BatchOptions } from "./batch"
import type { FileOptions } from "./file";
import type { RateLimitingOptions } from "../../rate-limiter/types";
import type { AppInfoOptions } from "../../app-info/types";
import type { WebsocketOptions } from "./../../websocket/options";



export interface ModuleOptions {
    clientModule?: boolean
    serverModule?: boolean
    
    app: AppInfoOptions,

    file?: FileOptions
    
    batch?: BatchOptions | false

    rateLimit?: RateLimitingOptions | false

    websocket?: WebsocketOptions | boolean

    scrub?: boolean
    
    public?: {
        endpoint?: string
        batch?: BatchOptions | false

        globalErrorCapture?: {
            includeComponent?: boolean
            includeComponentOuterHTML?: boolean
            includeComponentProps?: boolean
            includeStack?: boolean
            includeInfo?: boolean
        } | boolean
    }
}