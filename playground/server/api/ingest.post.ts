import type { LoggerObjectBatch } from "../../../src/runtime/shared/types/batch";



export default defineEventHandler(async (event) => {
    console.log('Ingest endpoint hit');

    const logBatch = await readBody<LoggerObjectBatch>(event);
});