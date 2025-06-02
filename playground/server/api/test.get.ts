export default defineEventHandler((event) => {
    const frogger = getFrogger(event);
    
    frogger.debug('Hello world');

    return {
        message: 'Hello world'
    }
});