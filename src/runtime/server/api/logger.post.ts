import { type LogObject } from 'consola';
import { eventHandler, readBody } from 'h3'
import { createFrogger } from '../utils';

const fileFrogger = createFrogger({
    file: {
        directory: 'logs',
        fileNameFormat: 'YYYY-MM-DD.log',
        maxSize: 10 * 1024 * 1024,
        format: 'json'
    },
    batch: false,
});

export default eventHandler(async (event) => {
    const logObj = await readBody<LogObject>(event);

    //@ts-expect-error
    fileFrogger.logToFile(logObj);
});