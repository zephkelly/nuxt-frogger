import type { LogContext } from "./log";



export interface FroggerOptions {
    level?: number;
    context?: LogContext;
    consoleOutput?: boolean | {
        browser?: boolean | { timestamp?: boolean };
        server?: boolean | { timestamp?: boolean }
    } | {
        timestamp?: boolean;
    };
}