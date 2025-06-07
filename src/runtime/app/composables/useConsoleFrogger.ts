import { useState } from '#app';
import { onMounted } from 'vue';

import { SimpleConsoleLogger } from '../../logger/other/console-frogger';
import type { IFroggerLogger } from '../../logger/types';



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