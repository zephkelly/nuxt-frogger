<template>
  <div>
    Nuxt module playground!
    <button @click="test()">Test</button>
    <button @click="test2()">Test2</button>
  </div>
</template>

<script setup>

const isServer = import.meta.server
const isClient = import.meta.client

const startFrogger = useFrogger();
startFrogger.info('Hello from the playground!', {
    server: isServer,
    client: isClient,
});

const test = () => {
    const clickFrogger = useFrogger();
    clickFrogger.info('Test button clicked!');
};

const test2 = async () => {
    const testFrogger = useFrogger();
    testFrogger.info('Test2 button clicked!');
  try {
    testFrogger.info('Fetching /api/test');
    const response = await fetch('/api/test');
    testFrogger.info('Response received', {
        response: response.status,
    });
  }
    catch (error) {
        testFrogger.error('Error fetching /api/test', {
            server: isServer,
            client: isClient,
            error: error.message,
        });
    }
};
</script>
