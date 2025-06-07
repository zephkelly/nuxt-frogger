export default defineEventHandler((event) => {
    const logger = getFrogger();

    logger.error('This endpoint does not exist', { event });

    return createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: {
            message: 'This endpoint does not exist. Please check the URL or contact support if you believe this is an error.'
        }
    })
});