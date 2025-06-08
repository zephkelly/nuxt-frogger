<template>
  <div>
    Nuxt module playground!
    <button @click="test()">Test</button>


    <Card :myProp="'Hello from the card!'" />
  </div>
</template>

<script setup>
const test = async () => {
    try {
        const response = await $fetch('/api/test', {
        });
    }
    catch (error) {
        
    }
};
</script>
