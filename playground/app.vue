<template>
  <div>
    Nuxt module playground!
    <button @click="test()">Test</button>
  </div>
</template>

<script setup>
import { server } from 'typescript';

const logger = useFrogger();

const isServer = import.meta.server
const isClient = import.meta.client

logger.info('Hello from the playground!', {
    server: isServer,
    client: isClient,
});
// logger.debug('Debugging the playground!');
// logger.warn('Warning from the playground!');
// logger.error('Error in the playground!');
// logger.success('Success in the playground!');
// logger.fatal('Fatal error in the playground!');
// logger.log('Custom log message from the playground!');
</script>
