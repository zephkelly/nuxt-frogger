export type AppInfoOptions = string | {
    name: string;
    version?: string;
} | undefined;


export type ExtractedAppInfo = {
    isSet: boolean;
    name?: string;
    version?: string;
}