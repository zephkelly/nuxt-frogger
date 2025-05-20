<template>
  <div>
    Nuxt module playground!
    <button @click="test()">Test</button>
    <button @click="test2()">Test2</button>
  </div>
</template>

<script setup>
const startFrogger = useFrogger();
startFrogger.info('Hello from the playground!');

const test = () => {
    const clickFrogger = useFrogger();
    clickFrogger.info('Test button clicked!');
};

const test2 = async () => {
    const testFrogger = useFrogger();
  try {
    testFrogger.error('Fetching /api/test');
    const response = await $fetch('/api/test', {
        headers: testFrogger.getHeaders(),
    });
    
    testFrogger.error('Response received', {
        response: response.status,
    });

    testFrogger.info('Carrying on');
  }
    catch (error) {
        testFrogger.error('Error fetching /api/test', {
            error: error.message,
        });
    }
};
</script>
