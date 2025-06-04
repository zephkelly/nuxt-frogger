<template>
    <div class="card">
        <h2>Card Component</h2>
        <p>{{ myProp }}</p>
        <button @click="testing()">Click me for an error!</button>
    </div>
</template>


<script lang="ts" setup>
type Props = {
    // Define any props if needed
    myProp?: string;
};

defineProps<Props>();

async function testing() {
    const number = Math.random();
    if (number < 0.5) {
        throw new Error('This is a test error');
    } else {
        console.log('No error this time, try again!');
    }

    //make a fetch to an endpoint that doesnt exist
    await $fetch('/api/test')
}
</script>