import type { BatchOptions } from "./batch"
import type { FileOptions } from "./file";
import type { RateLimitingOptions } from "../../rate-limiter/types";
import type { AppInfoOptions } from "../../app-info/types";
import type { WebsocketOptions } from "../../websocket/types/options";
import type { ScrubberOptions } from "../../scrubber/options";



export interface ModuleOptions {
    clientModule?: boolean
    serverModule?: {
        autoEventCapture?: boolean
    } | boolean
    
    app?: AppInfoOptions,

    file?: FileOptions
    
    batch?: BatchOptions | false

    rateLimit?: RateLimitingOptions | false

    websocket?: WebsocketOptions | boolean

    scrub?: ScrubberOptions | boolean
    
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

export const APP_MOUNTED_STATE_KEY = 'frogger-app-mounted-state';