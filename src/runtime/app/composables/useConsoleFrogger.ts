import { SimpleConsoleLogger } from '../../shared/utils/console-frogger';
import type { IFroggerLogger } from "../../shared/types/frogger";

import { useState } from '#app';
import { onMounted } from 'vue';


/**
 * Composable to access the Frogger logger from any component
 */
export function useConsoleFrogger(): IFroggerLogger {
    const hasMounted = useState<boolean>('frogger-has-mounted', () => false);
    const logger = new SimpleConsoleLogger();

    if (!hasMounted.value) {
        onMounted(() => {
            hasMounted.value = true;
        });
    };

    return logger;
}