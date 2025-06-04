import type { BatchOptions } from "./batch"
import type { FileOptions } from "./file";
import type { RateLimitingOptions } from "../../rate-limiter/types";

import type { AppInfoOptions } from "../../app-info/types";



export interface ModuleOptions {
    clientModule?: boolean
    serverModule?: boolean
    
    file?: FileOptions
    
    batch?: BatchOptions | false

    rateLimiter?: RateLimitingOptions | false
    
    public?: {
        app?: AppInfoOptions,

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