import { H3Event, H3Error, eventHandler, readBody, getHeader, createError } from 'h3'

import type { LoggerObjectBatch } from '../../shared/types/batch';

import { ServerLogQueueService } from '../services/server-log-queue';
import { RateLimitResponseFactory } from '../utils/rate-limit/response-factory';

interface LoopDetectionResult {
    isLoop: boolean;
    reason?: string;
    shouldWarn: boolean;
    metadata?: Record<string, any>;
}

/**
 * Detect potential logging loops from incoming requests
 */
function detectLoggingLoop(
    event: H3Event, 
    batch: LoggerObjectBatch
): LoopDetectionResult {
    const warnings: string[] = [];
    let isLoop = false;

    // Check for Frogger headers (primary detection method)
    const isFroggerRequest = getHeader(event, 'x-frogger-reporter') === 'true';
    const froggerReporterId = getHeader(event, 'x-frogger-reporter-id');
    const froggerProcessed = getHeader(event, 'x-frogger-processed') === 'true';
    const froggerSource = getHeader(event, 'x-frogger-source');

    if (froggerProcessed) {
        warnings.push('Request has Frogger processed header');
    }

    if (isFroggerRequest) {
        warnings.push(`Request originated from Frogger HTTP Reporter (ID: ${froggerReporterId})`);
        
        if (froggerSource && froggerSource === process.env.NUXT_APP_NAME) {
            isLoop = true;
            warnings.push(`LOOP DETECTED: Logs are coming from the same application (${froggerSource})`);
        }
    }

    // Metadata check
    if (batch.meta?.processed) {
        warnings.push('Batch metadata indicates Frogger processing');
        
        if (batch.meta.processChain?.length && batch.meta.processChain?.length > 1) {
            warnings.push(`Processing chain: ${batch.meta.processChain.join(' -> ')}`);
        }

        const chainSet = new Set(batch.meta.processChain);
        if (chainSet.size !== batch.meta.processChain?.length) {
            isLoop = true;
            warnings.push('LOOP DETECTED: Circular processing chain detected');
        }

        if (batch.meta.time) {
            const age = Date.now() - batch.meta.time;
            if (age > 300000) { // 5 minutes
                warnings.push(`Old logs detected (${Math.round(age / 1000)}s old) - possible retry loop`);
            }

            if (age > 600000) { // 10 minutes
                isLoop = true;
                warnings.push(`LOOP DETECTED: Logs are older than 10 minutes (${Math.round(age / 1000)}s old)`);
            }
        }
    }

    return {
        isLoop,
        reason: warnings.join('; '),
        shouldWarn: isFroggerRequest || warnings.length > 0,
        metadata: {
            isFroggerRequest,
            froggerReporterId,
            froggerSource,
            processingChain: batch.meta?.processChain,
            age: batch.meta && batch.meta.time ? Date.now() - batch.meta.time : null,
        }
    };
}

import { getRateLimiter, extractRateLimitIdentifier } from '../services/rate-limiter';

export default eventHandler(async (event) => {
    const rateLimiter = getRateLimiter();

    // Only check rate limits if enabled
    if (rateLimiter.isRateLimitingEnabled()) {
        const identifier = extractRateLimitIdentifier(event);
        const rateLimitResult = await rateLimiter.checkRateLimit(identifier);

        if (rateLimitResult && !rateLimitResult.allowed) {
            // Log the rate limit violation for monitoring
            console.warn(
                '%cFROGGER RATE LIMIT', 
                'color: white; background-color: #f59e0b; font-weight: bold; font-size: 1.1rem;',
                `⚠️ Rate limit exceeded for ${identifier.ip} (${rateLimitResult.tier} tier): ${rateLimitResult.current}/${rateLimitResult.limit}`
            );

            // Block IP if this is a rate limit violation (not already blocked)
            if (!rateLimitResult.isBlocked) {
                await rateLimiter.blockIP(identifier.ip);
                console.warn(
                    '%cFROGGER IP BLOCKED', 
                    'color: white; background-color: #dc2626; font-weight: bold; font-size: 1.2rem;',
                    `🚨 IP ${identifier.ip} has been blocked due to rate limit violations`
                );
            }
            
            // Return rate limit error response
            const response = RateLimitResponseFactory.createH3Response(rateLimitResult);
            throw createError(response);
        }

        // Log successful rate limit check in debug mode
        if (import.meta.dev) {
            console.debug(`Rate limit check passed for ${identifier.ip}: ${rateLimitResult?.current || 0} requests`);
        }
    }


    const logBatch = await readBody<LoggerObjectBatch>(event);

    try {
        const loopDetectionResult = detectLoggingLoop(event, logBatch);

        if (loopDetectionResult.isLoop || loopDetectionResult.shouldWarn) {
            if (loopDetectionResult.shouldWarn) {
                console.warn(
                    '%cFROGGER WARNING', 
                    'color: black; background-color: #f59e0b; font-weight: bold; font-size: 1.1rem;',
                    `⚠️    Potential loop risk: ${loopDetectionResult.reason}
                            If you are seeing this, it is likely that your HttpReporter endpoint is misconfigured.
                            Ensure your destination endpoint is correct. If you are using a custom reporter, ensure
                            it is not pointing to the logging endpoint.
                    `,
                );
            }
            
            if (loopDetectionResult.isLoop) {
                console.error(
                    '%cFROGGER LOOP DETECTED', 
                    'color: white; background-color: #dc2626; font-weight: bold; font-size: 1.2rem;',
                    `🚨 ${loopDetectionResult.reason}`
                );
            }
            
            // Return error to break the loop
            throw createError({
                statusCode: 400,
                statusMessage: 'Logging loop detected',
                data: {
                    error: 'FROGGER_LOOP_DETECTED',
                    reason: loopDetectionResult.reason,
                }
            });
        }

        

        const serverLogQueue = ServerLogQueueService.getInstance();
        serverLogQueue.enqueueBatch(logBatch);
    }
    catch (error: unknown) {
        if (error instanceof H3Error) {
            throw error
        }

        throw createError({
            statusCode: 500,
            statusMessage: 'Internal Server Error',
        })
    }
});