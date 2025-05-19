import { ServerFroggerLogger } from "./server-frogger";
import type { ServerLoggerOptions } from "../types/logger";

import type { ServerLogger } from "../types/logger";



export function createFrogger(options?: ServerLoggerOptions): ServerLogger {
    return new ServerFroggerLogger(options);
}