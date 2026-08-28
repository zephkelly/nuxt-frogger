/** Headers never shipped in an error report, whatever the scrub config says. */
export const DENIED_HEADERS: readonly string[] = [
    'cookie',
    'set-cookie',
    'authorization',
    'proxy-authorization',
    'x-api-key',
    'x-auth-token',
    'x-csrf-token',
];

/** Cap on a captured `outerHTML` blob. Rendered markup is unbounded PII. */
export const OUTER_HTML_MAX_CHARS = 4096;

export interface GlobalErrorCaptureOptions {
    client: {
        includeComponent?: boolean;

        /**
         * Attach the failing component's `$props`.
         *
         * OFF by default: props routinely carry PII and tokens, and they land
         * in `ctx.component` where the app author never chose to put them.
         *
         * @default false
         */
        includeComponentProps?: boolean;

        /**
         * Attach the failing component's rendered `outerHTML`, truncated to
         * {@link OUTER_HTML_MAX_CHARS}.
         *
         * OFF by default: rendered markup is rendered user data, and an
         * untruncated blob can push a row past the 1 MiB ingest cap, whose 413
         * the client queue treats as "drop the whole queue".
         *
         * @default false
         */
        includeComponentOuterHTML?: boolean;

        includeInfo?: boolean;
        includeStack?: boolean;
    };

    server: {
        includeRequestContext?: boolean;

        /**
         * Attach request headers. `true` sends every header EXCEPT the
         * {@link DENIED_HEADERS} deny-list, which is applied unconditionally.
         * Pass an array to send only those headers instead.
         *
         * @default false
         */
        includeHeaders?: boolean | string[];

        includeRejectionHandled?: boolean;
        includeWarnings?: boolean;
        includeStack?: boolean;

        /**
         * Skip the Nitro `error` hook report when the error was already
         * serialised into a log row by a handler's own catch.
         * @default true
         */
        dedupe?: boolean;

        /**
         * Install `SIGTERM`/`SIGINT` handlers that drain and then call
         * `process.exit(0)`.
         *
         * OFF by default. A logging library owning host shutdown is not its
         * business: on a rolling deploy the platform sends SIGTERM expecting
         * the HTTP server to finish in-flight requests, and exiting ~3s later
         * truncates any longer request and every other shutdown handler the app
         * registered. Nitro's `close` hook already drains the queue.
         *
         * Turn it on only if your deployment has no Nitro close path.
         *
         * @default false
         */
        takeoverSignals?: boolean;

        /**
         * Call `process.exit(1)` after draining on an uncaught exception.
         *
         * OFF by default: the crash is logged and drained either way, and
         * whether the process survives an uncaught exception is the host's
         * decision, not the logger's.
         *
         * @default false
         */
        exitOnUncaught?: boolean;

        /** How long a drain may hold up shutdown, in ms. @default 3000 */
        drainTimeoutMs?: number;
    };
}