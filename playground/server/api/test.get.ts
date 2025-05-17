export default defineEventHandler((event) => {
    frogger.warn('Hello world');

    return {
        message: 'Hello world'
    }
});