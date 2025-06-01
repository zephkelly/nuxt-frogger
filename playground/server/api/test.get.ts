export default defineEventHandler((event) => {
    const frogger = getFrogger(event);
    
    frogger.warn('Hello world');
    frogger.addReporter({
        log: async(log) => {
            console.log(log);
        }
    })

    return {
        message: 'Hello world'
    }
});