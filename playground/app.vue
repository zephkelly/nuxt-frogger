<template>
  <div>
    Nuxt module playground!
    <button @click="testing()">Test</button>
    <button @click="test2()">Test2</button>
    <button @click="test3()">Start High traffic</button>

    <Card :myProp="'Hello from the card!'" />
  </div>
</template>

<script setup>
const startFrogger = useFrogger();
startFrogger.error('Hello from the playground!');



const testing = () => {
    const clickFrogger = useFrogger();

    clickFrogger.info('Button clicked', {
        my: {
            deeply: {
                nested: {
                    password: 'awdaw'
                }
            }
        }
    });
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


const test3 = () => {
    const highTrafficFrogger = useFrogger();
    let intervalId;

    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        highTrafficFrogger.info('High traffic simulation stopped');
    } else {
        intervalId = setInterval(() => {
            highTrafficFrogger.info('High traffic simulation log');
        }, 1000);
        highTrafficFrogger.info('High traffic simulation started');
    }
};


const socket = useWebsocket('/api/_frogger/dev-ws', {
    auto_connect: true,
    heartbeat: {
        auto_heartbeat: true,
    },
    queryParams: {
        channel: 'main',
        level: 0,
    },
    onMessage: async (event, message) => {
        console.log('WebSocket message received:', message);
    }
});
</script>
