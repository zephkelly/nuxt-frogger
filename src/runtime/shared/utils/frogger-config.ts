import { join } from 'node:path'
import { existsSync } from 'node:fs'

import type { ModuleOptions } from '../types/module-options'



export async function loadFroggerConfig(rootDir: string): Promise<ModuleOptions | null> {
    const configPath = join(rootDir, 'frogger.config.ts')
    const configJsPath = join(rootDir, 'frogger.config.js')
    
    let configFile = null
    if (existsSync(configPath)) {
        configFile = configPath
    }
    else if (existsSync(configJsPath)) {
        configFile = configJsPath
    }
    
    if (!configFile) {
        return null
    }

    try {
        const configModule = await import(configFile)
        
        const config = configModule.default || configModule
        
        if (typeof config === 'function') {
            return config()
        }
        
        return config
    }
    catch (error) {
        console.log(
            '%cFROGGER WARN', 'color: black; background-color: rgb(9, 195, 81); font-weight: bold; font-size: 1.15rem;',
            '🐸 Failed to load frogger.config.ts file!'
        )
        return null
    }
}



/**
 * Define Frogger options with full type safety
 * @param options - Frogger configuration options
 * @returns The configuration options
 */
export function defineFroggerOptions(options: ModuleOptions): ModuleOptions {
    return options
}