export interface RateLimitingOptions {
    limits?: {
        global?: number;
        perIp: number;
        perReporter?: number;
        perApp?: number;
    };
    
    windows?: {
        global?: number;
        perIp: number;
        perReporter?: number;
        perApp?: number;
    };
    
    blocking?: {
        enabled: boolean;
        escalationResetHours: number;
        finalBanHours: number;
        violationsBeforeBlock: number;
        timeouts: number[];
    };

    storage?: {
        driver?: string;
        options?: Record<string, any>;
    };
}