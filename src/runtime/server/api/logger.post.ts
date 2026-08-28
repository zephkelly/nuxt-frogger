import { H3Event, H3Error, eventHandler, getHeader, createError } from 'h3'

import type { LoggerObjectBatch } from '../../shared/types/batch';

import { ServerLogQueueService } from '../services/server-log-queue';
import { getFroggerRateLimiter } from '../../rate-limiter';
import { froggerInternal } from '../../shared/utils/internal-log';
import { readBoundedRawBody, safeRequestIp } from '../utils/read-bounded-body';
import { validateLogBatch } from '../utils/validate-log-batch';
import { useFroggerConfig } from '../../shared/utils/use-frogger-config';



const MAX_REQUEST_BYTES = 1024 * 1024;

interface LoopDetectionResult {
    isLoop: boolean;
    reason?: string;
    shouldWarn: boolean;
    metadata?: Record<string, any>;
}

/**
 * Classify an incoming batch as a genuine loop (reject) or merely relayed
 * (warn). The distinction is load-bearing: every frogger-to-frogger relay sets
 * `x-frogger-processed`, so treating "was processed" as a loop rejects 100% of
 * legitimate relay traffic - and a 400 is exactly what the client queue and
 * HttpTransport treat as "drop, do not retry".
 */
function detectLoggingLoop(
    event: H3Event,
    batch: LoggerObjectBatch,
    selfName: string | undefined,
): LoopDetectionResult {
    const warnings: string[] = [];
    let isLoop = false;

    const froggerReporterId = getHeader(event, 'x-frogger-reporter-id');
    const froggerProcessed = getHeader(event, 'x-frogger-processed') === 'true';
    const froggerSource = getHeader(event, 'x-frogger-source');
    // A relay hop is anything that came through a frogger transport. The old
    // `x-frogger-reporter` header this keyed on is set by nothing in the repo,
    // which made the only self-loop branch unreachable.
    const isFroggerRequest = froggerProcessed || Boolean(froggerReporterId);

    if (froggerProcessed) {
        warnings.push('Request has Frogger processed header');
    }

    if (isFroggerRequest) {
        warnings.push(`Request originated from a Frogger transport (ID: ${froggerReporterId ?? 'unknown'})`);

        // Compare against the RESOLVED app name from runtime config.
        // `process.env.NUXT_APP_NAME` is unset in a normal Nuxt deploy, so the
        // old comparison could never be true.
        if (froggerSource && selfName && froggerSource === selfName) {
            isLoop = true;
            warnings.push(`LOOP DETECTED: Logs are coming from the same application (${froggerSource})`);
        }
    }

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

            if (age > 600000) {
                isLoop = true;
                warnings.push(`LOOP DETECTED: Logs are older than 10 minutes (${Math.round(age / 1000)}s old)`);
            }
        }
    }

    return {
        isLoop,
        reason: warnings.join('; '),
        shouldWarn: warnings.length > 0,
        metadata: {
            isFroggerRequest,
            froggerReporterId,
            froggerSource,
            processingChain: batch.meta?.processChain,
            age: batch.meta && batch.meta.time ? Date.now() - batch.meta.time : null,
        }
    };
}


export default eventHandler(async (event) => {
    await getFroggerRateLimiter().check(event);

    const raw = await readBoundedRawBody(event, MAX_REQUEST_BYTES);

    let parsed: unknown;
    try {
        if (!raw) throw new Error('empty body');
        parsed = JSON.parse(raw);
    }
    catch {
        throw createError({
            statusCode: 400,
            statusMessage: 'Invalid log batch body',
            data: { error: 'FROGGER_BAD_BODY' },
        });
    }

    const validation = validateLogBatch(parsed);
    if (!validation.ok) {
        throw createError({
            statusCode: 400,
            statusMessage: validation.failure.message,
            data: { error: validation.failure.code },
        });
    }

    const logBatch = validation.batch;

    try {
        const selfName = useFroggerConfig().resource?.['service.name'];

        const loopDetectionResult = detectLoggingLoop(event, logBatch, selfName);

        if (loopDetectionResult.shouldWarn) {
            froggerInternal.warn(
                `⚠️  Potential loop risk: ${loopDetectionResult.reason}\n` +
                `    If you are seeing this, it is likely that your HttpReporter endpoint is misconfigured.\n` +
                `    Ensure your destination endpoint is correct. If you are using a custom reporter, ensure\n` +
                `    it is not pointing to the logging endpoint.`
            );
        }

        // Only a genuine loop is rejected. A warned-but-legitimate relay batch
        // is accepted and ingested like any other.
        if (loopDetectionResult.isLoop) {
            froggerInternal.error(`🚨 LOOP DETECTED: ${loopDetectionResult.reason}`);

            throw createError({
                statusCode: 400,
                statusMessage: 'Logging loop detected',
                data: {
                    error: 'FROGGER_LOOP_DETECTED',
                    reason: loopDetectionResult.reason,
                }
            });
        }

        logBatch.meta = {
            ...logBatch.meta,
            received: {
                at: Date.now(),
                ip: safeRequestIp(event),
            },
        };

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
