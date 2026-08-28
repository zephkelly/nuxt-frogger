import { join } from 'node:path'
import { existsSync } from 'node:fs'

import type { ModuleOptions } from '../types/module-options'
import { froggerInternal } from './internal-log'



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
        // Hard-fail rather than warn-and-continue. This runs at build time,
        // where `froggerInternal` resolves to silent, so the old path reverted
        // to a completely different configuration with no output at all - and
        // there is no scenario where silently running a config the author did
        // not write is what they wanted.
        throw new Error(
            `🐸FROGGER: failed to load ${configFile}. Fix the config file or remove it.\n`
            + `  ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        )
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