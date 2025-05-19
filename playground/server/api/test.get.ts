export default defineEventHandler((event) => {
    const frogger = createFrogger();
    
    frogger.warn('Hello world');

    frogger.error('Hello world');

    frogger.info('Hello world');

    return {
        message: 'Hello world'
    }
});