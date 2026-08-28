import type { ScrubRule } from "./types";
import type { ValuePattern } from "./value-patterns";



export interface ScrubberOptions {
    /** Recursion bound for nested objects. Omit/undefined = no limit (cycle-safe). */
    maxDepth?: number;
    deepScrub?: boolean;
    preserveTypes?: boolean;
    rules?: ScrubRule[];

    /**
     * Redact by the SHAPE of a value rather than the name of its key.
     *
     * Key rules cannot catch a token pasted into a `note` field or an email
     * inside a message; these can. `true` uses the default set (email, Bearer
     * token, JWT, Luhn-valid card number); pass an array for your own.
     *
     * OFF by default because it runs regexes over every string in every log.
     * Measure before enabling it on a hot path.
     *
     * @default false
     */
    values?: boolean | ValuePattern[];

    /**
     * Also run {@link values} over the log MESSAGE, not just context.
     *
     * Separate from `values` because a message is the thing a developer reads
     * to understand what happened, and redacting inside it is a bigger
     * behavioural change than redacting a context field.
     *
     * @default false
     */
    message?: boolean;
}