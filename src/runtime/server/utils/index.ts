import { ServerFrogger } from "./frogger";
import type { ServerLoggerOptions } from "../types/logger";

import type { Frogger } from "../../shared/types/frogger";


export function createFrogger(options: ServerLoggerOptions = {}): Frogger {
    return new ServerFrogger(options);
}

export const frogger: Frogger = createFrogger();