export default defineEventHandler((event) => {
    console.log('Ingest endpoint hit', event.headers);
});