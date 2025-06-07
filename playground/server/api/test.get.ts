export default defineEventHandler((event) => {
    const logger = getFrogger();

    logger.error('This endpoint checks to see if the trace context propagates properly');

    return 'request received and logged successfully';
});