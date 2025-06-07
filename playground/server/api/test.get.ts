export default defineEventHandler((event) => {
    const logger = getFrogger({
        context: {
            myField: 'myValue',
        }
    }, event);

    logger.error('This endpoint checks to see if the trace context propagates properly');
    logger.addContext({
        additionalField: 'additionalValue',
    });
    logger.info('This is a log message with additional context');

    logger.addContext({
        anotherField: 'anotherValue',
    });

    logger.info('This is another log message with additional context');

    const childLogger = logger.child({
        context: {
            childField: 'childValue',
        }   
    })

    childLogger.info('This is a child logger with its own context');

    logger.addContext({
        finalField: 'finalValue',
    })

    childLogger.info('This is a log message from the child logger with additional context from parent');

    // // logger.addContext({
    // //     additionalField: 'additionalValue',
    // // })
    // logger.info('This is a log message with additional context');

    // childLogger.log('This is a log message from the child logger with additional context from parent');

    return 'request received and logged successfully';
});