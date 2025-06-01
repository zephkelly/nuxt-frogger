export default defineEventHandler((event) => {
    const frogger = getFrogger(event);
    
    frogger.debug('Hello world');
    frogger.trace('This is a trace message', { additional: 'context' });
    frogger.info('This is an info message', { more: 'details' });
    frogger.success('This is a success message', { extra: 'info' });
    frogger.fail('This is a fail message', { error: 'details' });
    frogger.ready('This is a ready message', { status: 'ready' });
    frogger.start('This is a start message', { process: 'initializing' });
    frogger.log('This is a log message', { log: 'details' });
    frogger.warn('This is a warning message', { warning: 'details' });
    frogger.addReporter({
        log: async(log) => {
            console.log(log);
        }
    })

    return {
        message: 'Hello world'
    }
});