import type { BatchOptions } from "./batch"
import type { FileOptions } from "./file";
import type { RateLimitingOptions } from "../../rate-limiter/types";


export interface ModuleOptions {
    clientModule?: boolean
    serverModule?: boolean
    
    file?: FileOptions
    
    batch?: BatchOptions | false

    rateLimiter?: RateLimitingOptions | false
    
    public?: {
        endpoint?: string
        batch?: BatchOptions | false
    }
}