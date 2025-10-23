<template>
  <div>
    Nuxt module playground!
    <button @click="test()">Test</button>


    <Card :myProp="'Hello from the card!'" />
  </div>
</template>

<script setup>
const socket = useWebsocket({
    onMessage: (event) => {
        console.log('Received message:', event.data);
    },
});

onMounted(() => {
    if (!import.meta.client) return

    socket.connect('main', {
        filters: JSON.stringify({
            level: [1, 0],
        })
    });
});

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
