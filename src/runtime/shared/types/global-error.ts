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
    };
}