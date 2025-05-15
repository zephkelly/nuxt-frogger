export default defineEventHandler((event) => {

    const traceId = getTraceId(event);
    // const sessionTraceId = getSessionTraceId(event);

    // console.log('sessionTraceId', sessionTraceId);

    return {
        traceId,
        // sessionTraceId,
    }
});