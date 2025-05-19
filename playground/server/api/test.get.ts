export default defineEventHandler((event) => {
    const frogger = createFrogger();
    frogger.warn('Hello world');

    return {
        message: 'Hello world'
    }
});