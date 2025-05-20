export default defineEventHandler((event) => {
    console.log(event.context.frogger);
    const frogger = getFrogger();
    
    frogger.warn('Hello world');

    frogger.error('Hello world');

    frogger.info('Hello world');

    return {
        message: 'Hello world'
    }
});