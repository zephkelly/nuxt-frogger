import type { BatchOptions } from "./batch"
import type { FileOptions } from "./file";



export interface ModuleOptions {
    clientModule?: boolean
    serverModule?: boolean
    
    
    file?: FileOptions
    
    batch?: BatchOptions | false
    
    public?: {
        endpoint?: string
        batch?: BatchOptions | false
    }
}