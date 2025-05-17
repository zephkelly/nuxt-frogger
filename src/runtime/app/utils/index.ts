import { ClientFrogger } from "./frogger";
import type { ClientLoggerOptions } from "../types/logger";

import type { Frogger } from "../../shared/types/frogger";



export function createFrogger(options: ClientLoggerOptions = {}): Frogger {
    return new ClientFrogger(options);
}

export const clientFrogger: Frogger = createFrogger();