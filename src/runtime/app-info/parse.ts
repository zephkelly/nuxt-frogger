import type { ExtractedAppInfo } from "./types";


/**
 * Extracts app information from the app config
 * @param app - The app configuration (string, object, or undefined)
 * @returns Object with isSet boolean, name string, and version string
 */
export function parseAppInfoConfig(app: any): ExtractedAppInfo {
    if (!app) {
        return {
            isSet: false,
            name: undefined,
            version: undefined
        };
    }

    if (typeof app === 'string') {
        return {
            isSet: true,
            name: app,
        };
    }

    return {
        isSet: true,
        name: app.name,
        version: app.version || undefined
    };
}
