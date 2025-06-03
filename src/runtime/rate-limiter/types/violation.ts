export interface ViolationRecord {
    count: number;
    firstViolation: number;
    lastViolation: number;
    currentBackoffTier: number;
    isBlocked: boolean;
    blockExpiresAt?: number;
    lastAction?: 'backoff' | 'block';
    escalationHistory?: Array<{
        timestamp: number;
        action: 'backoff' | 'block';
        tier?: number;
        duration?: number;
    }>;
}
