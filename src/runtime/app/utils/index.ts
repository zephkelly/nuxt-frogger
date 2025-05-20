import { ClientFrogger } from "./client-logger";
import type { ClientLoggerOptions } from "../types/logger";

import type { ClientLogger } from "../types/logger";



export function createFrogger(options: ClientLoggerOptions = {}): ClientLogger {
    return new ClientFrogger(options);
}