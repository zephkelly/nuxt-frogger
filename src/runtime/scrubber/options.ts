import type { ScrubRule } from "./types";



export interface ScrubberOptions {
    /** Recursion bound for nested objects. Omit/undefined = no limit (cycle-safe). */
    maxDepth?: number;
    deepScrub?: boolean;
    preserveTypes?: boolean;
    rules?: ScrubRule[];
}