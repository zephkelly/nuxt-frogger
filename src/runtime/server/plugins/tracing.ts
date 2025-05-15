import { defineNitroPlugin } from "#imports";
import { setTracingHeaders } from "../internal/utils/setTracingHeaders";



export default defineNitroPlugin((nitroApp) => {
    console.log('Tracing plugin loaded');
    nitroApp.hooks.hook('request', (event) => {
        setTracingHeaders(event);
    })
});