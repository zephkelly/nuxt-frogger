import { eventHandler, readBody } from 'h3'

import type { LoggerObjectBatch } from '../../shared/types/batch';

import { ServerLogQueueService } from '../services/server-log-queue';



export default eventHandler(async (event) => {
    const LoggerObjectBatch = await readBody<LoggerObjectBatch>(event);
    
    const serverLogQueue = ServerLogQueueService.getInstance();
    serverLogQueue.enqueueBatch(LoggerObjectBatch);
});