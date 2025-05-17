import { createConsola } from "consola";


export default defineEventHandler((event) => {

    const consola = createConsola({
        level: 3,
        reporters: [
            {
                log(logObj) {
                    console.log(logObj);
                }
            }
        ]
    });

    consola.info('Hello world');

    consola.fatal('Hello world');

    consola.log('Hello world');

    return {
        message: 'Hello world'
    }
});