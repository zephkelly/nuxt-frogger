export type AppInfoOptions =  {
    name: string;
    version?: string;
} | string


export type ExtractedAppInfo = {
    isSet: boolean;
    name?: string;
    version?: string;
}