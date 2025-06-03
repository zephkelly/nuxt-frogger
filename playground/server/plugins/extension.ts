export default defineNitroPlugin((nitroApp) => {
    addGlobalReporter(createHttpReporter('/api/ingest'));
});