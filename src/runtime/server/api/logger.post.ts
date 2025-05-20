import { eventHandler, readBody } from 'h3'

import type { LogBatch } from '../../shared/types/batch';

import { ServerLogQueueService } from '../services/server-log-queue';



export default eventHandler(async (event) => {
    const logBatch = await readBody<LogBatch>(event);
    
    const serverLogQueue = ServerLogQueueService.getInstance();
    serverLogQueue.enqueueBatch(logBatch);
});