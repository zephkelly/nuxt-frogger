import { ServerFroggerLogger } from "./server-frogger";
import type { ServerLoggerOptions } from "../types/logger";

import type { ServerLogger } from "../types/logger";

import { useRequestEvent, useNuxtApp } from "#app";



export function useFrogger(options?: ServerLoggerOptions): ServerLogger {
    const nuxtApp = useNuxtApp();
    const event = useRequestEvent();

    return new ServerFroggerLogger(options);
}