<template>
  <div>
    Nuxt module playground!
    <button @click="test()">Test</button>


    <Card :myProp="'Hello from the card!'" />
  </div>
</template>

<script setup>
const socket = useWebsocket();

const test = async () => {
    const logger = useFrogger();

    logger.info('Testing logger');
    
    try {
        const response = await $fetch('/api/test', {
            headers: logger.getHeaders('uat_cp_rrs')
        });
    }
    catch (error) {
        
    }
};
</script>
