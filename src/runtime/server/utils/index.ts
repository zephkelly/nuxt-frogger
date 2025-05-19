import { ServerFrogger } from "./frogger";
import type { ServerLoggerOptions } from "../types/logger";

import type { Frogger } from "../../shared/types/frogger";

export function createFrogger(options: ServerLoggerOptions = {}): Frogger {
    return new ServerFrogger(options);
}

export const frogger: Frogger = createFrogger({
    file: {
        directory: 'logs',
        fileNameFormat: 'YYYY-MM-DD.log',
        maxSize: 10 * 1024 * 1024,
        format: 'json'
    },
    batch: true,
    endpoint: '/api/_frogger/logs'
});