<template>
  <div>
    Nuxt module playground!
    <button @click="test()">Test</button>


    <Card :myProp="'Hello from the card!'" />
  </div>
</template>

<script setup>
const ssrFrogger = useFrogger()
ssrFrogger.info('SSR Frogger initialized!')


const test = async () => {
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

function test2 () {

}

onMounted(() => {
    console.log('Mounted!');
})


// const socket = useWebsocket('/api/_frogger/dev-ws', {
//     auto_connect: true,
//     heartbeat: {
//         auto_heartbeat: true,
//     },
//     queryParams: {
//         channel: 'main',
//         level: 0,
//     },
//     onMessage: async (event, message) => {
//         console.log('WebSocket message received:', message);
//     }
// });
</script>
