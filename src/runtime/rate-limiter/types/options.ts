/**
 * How much of the forwarding chain to believe.
 *
 * - `false` (default): the socket peer address only. Forwarding headers are
 *   ignored entirely.
 * - `number`: trust that many proxy hops, counted from the right of
 *   `x-forwarded-for`.
 * - `true`: shorthand for one hop.
 * - `string[]`: peer addresses whose forwarding headers are trusted.
 *
 * Defaults to `false` because the failure is asymmetric: trusting headers on
 * an untrusted hop means an attacker rotating `x-real-ip` is never limited,
 * and one spoofing a victim's address drives that address into the escalating
 * block list. Not trusting them behind a proxy merely means every request
 * shares one bucket, which is visible immediately.
 */
export type TrustProxyOption = boolean | number | string[]

export interface RateLimitingOptions {
    /**
     * Which forwarding headers to believe when resolving the client address.
     * See {@link TrustProxyOption}.
     *
     * @default false
     */
    trustProxy?: TrustProxyOption

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