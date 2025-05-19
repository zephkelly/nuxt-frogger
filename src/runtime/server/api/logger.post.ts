import { type LogObject } from 'consola';
import { eventHandler, readBody } from 'h3'
import { createFrogger } from '../utils';


export default eventHandler(async (event) => {
    const logObj = await readBody<LogObject>(event);
    
    const fileFrogger = createFrogger();
    fileFrogger.logToFile(logObj);
});