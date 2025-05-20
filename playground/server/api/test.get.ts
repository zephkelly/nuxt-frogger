export default defineEventHandler((event) => {
    const frogger = useFrogger();
    
    frogger.warn('Hello world');

    frogger.error('Hello world');

    frogger.info('Hello world');

    return {
        message: 'Hello world'
    }
});