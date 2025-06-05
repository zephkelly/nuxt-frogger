import type { ScrubRule } from "./types";



export interface ScrubberOptions {
    maxDepth?: number;
    deepScrub?: boolean;
    preserveTypes?: boolean;
    rules?: ScrubRule[];
}