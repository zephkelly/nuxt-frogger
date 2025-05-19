import { ClientFrogger } from "./client-frogger";
import type { ClientLoggerOptions } from "../types/logger";

import type { ClientLogger } from "../types/logger";



export function createFrogger(options: ClientLoggerOptions = {}): ClientLogger {
    return new ClientFrogger(options);
}