export type StatusCode = 
    // 4xx Client Errors
    | 400  // Bad Request
    | 401  // Unauthorized
    | 403  // Forbidden
    | 404  // Not Found
    | 405  // Method Not Allowed
    | 409  // Conflict
    | 422  // Validation Error
    | 429  // Too Many Requests
    // 5xx Server Errors
    | 500  // Internal Server Error
    | 501  // Not Implemented
    | 502  // Bad Gateway
    | 503  // Service Unavailable
    | 504  // Gateway Timeout
    | 550  // Database Error
    | 551; // External Service Error

    
// Shared status codes object for easy access
export const STATUS_CODES = {
    // 4xx Client Errors
    BAD_REQUEST: 400 as const,
    UNAUTHORIZED: 401 as const,
    FORBIDDEN: 403 as const,
    NOT_FOUND: 404 as const,
    METHOD_NOT_ALLOWED: 405 as const,
    CONFLICT: 409 as const,
    VALIDATION_ERROR: 422 as const,
    TOO_MANY_REQUESTS: 429 as const,

    // 5xx Server Errors
    INTERNAL_SERVER_ERROR: 500 as const,
    NOT_IMPLEMENTED: 501 as const,
    BAD_GATEWAY: 502 as const,
    SERVICE_UNAVAILABLE: 503 as const,
    GATEWAY_TIMEOUT: 504 as const,
    DATABASE_ERROR: 550 as const,
    EXTERNAL_SERVICE_ERROR: 551 as const,
} as const;


// Default status messages mapping
export const STATUS_MESSAGES: Record<StatusCode, string> = {
    // 4xx Client Errors
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    409: 'Conflict',
    422: 'Validation Error',
    429: 'Too Many Requests',

    // 5xx Server Errors
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
    550: 'Database Error',
    551: 'External Service Error',
};