import { ClientFrogger } from "../utils/client-logger";
import type { IFroggerLogger } from "../../shared/types/frogger";

import { useState } from '#app';
import { computed, onMounted } from 'vue';


/**
 * Composable to access the Frogger logger from any component
 */
export function useFrogger(): IFroggerLogger {
    const hasMounted = useState<boolean>('frogger-has-mounted', () => false);
    const logger = new ClientFrogger(computed(() => hasMounted.value));

    if (!hasMounted.value) {
        onMounted(() => {
            hasMounted.value = true;
        });
    };

    return logger;
}