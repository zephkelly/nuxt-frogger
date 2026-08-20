export interface GlobalErrorCaptureOptions {
    client: {
        includeComponent?: boolean;
        includeComponentProps?: boolean;
        includeComponentOuterHTML?: boolean;
        includeInfo?: boolean;
        includeStack?: boolean;
    };

    server: {
        includeRequestContext?: boolean;
        includeHeaders?: boolean;
        includeRejectionHandled?: boolean;
        includeWarnings?: boolean;
        includeStack?: boolean;
        /**
         * Skip the Nitro `error` hook report when the error was already
         * serialised into a log row by a handler's own catch.
         * @default true
         */
        dedupe?: boolean;
    };
}