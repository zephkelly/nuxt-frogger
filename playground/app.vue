<template>
  <div>
    Nuxt module playground!
    <button @click="test()">Test</button>


    <Card :myProp="'Hello from the card!'" />
  </div>
</template>

<script setup>
const test = async () => {
    const logger = useFrogger();
    
    try {
        const response = await $fetch('/api/test', {
            headers: logger.getHeaders()
        });
    }
    catch (error) {
        
    }
};
</script>
