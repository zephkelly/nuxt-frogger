import { computed } from 'vue';
import { useState } from '#imports';

import { ClientFrogger } from '../../logger/client';
import type { IFroggerLogger } from '../../logger/types';

import { APP_MOUNTED_STATE_KEY } from '../../shared/types/module-options';



/**
 * Composable to access the Frogger logger from any component
 */
export function useFrogger(): IFroggerLogger {
    //@ts-ignore
    const hasMounted = useState<boolean>(APP_MOUNTED_STATE_KEY, () => false);

    const logger = new ClientFrogger(computed(() => hasMounted.value));

    return logger;
}