<template>
  <div>
    Nuxt module playground!
    <button @click="test()">Test</button>
    <button @click="test2()">Test2</button>
  </div>
</template>

<script setup>
const logger = useFrogger();

const isServer = import.meta.server
const isClient = import.meta.client

logger.info('Hello from the playground!', {
    server: isServer,
    client: isClient,
});

const test = () => {
  logger.info('Test button clicked!', {
    server: isServer,
    client: isClient,
  });
};

const test2 = () => {
  logger.warn('Test button clicked!', {
    server: isServer,
    client: isClient,
  });
};
</script>
