export default defineNitroPlugin((nitroApp) => {
    addGlobalReporter(createHttpReporter('/api/_frogger/logs'));
});