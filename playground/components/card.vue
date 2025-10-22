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
    const clickFrogger = useFrogger({});
    const number = Math.random();
    if (number < 0.5) {
        for (let i = 0; i < 2; i++) {
            clickFrogger.error(`Click number ${i + 1}`);
        }
    } else {
        console.log('No error this time, try again!');
    }

    await $fetch('/api/test')
}
</script>