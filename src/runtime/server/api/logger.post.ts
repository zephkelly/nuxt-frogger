import { frogger } from '#imports';
import { type LogObject } from 'consola';
import { eventHandler, readBody } from 'h3'


export default eventHandler(async (event) => {
    // here we ingest a consola log object
    const logObj = await readBody<LogObject>(event);

    console.log('logObj', logObj);

});