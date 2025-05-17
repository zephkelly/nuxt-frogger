export default defineEventHandler((event) => {
    serverFrogger.warn('Hello world');

    return {
        message: 'Hello world'
    }
});