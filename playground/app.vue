<template>
  <div>
    Nuxt module playground!
    <button @click="test()">Test</button>
  </div>
</template>

<script setup>
async function test() {
    clientFrogger.log('test')
    try {
        const response = await $fetch('/api/test')
        console.log(response)
    } catch (error) {
        console.error('Error fetching /api/test:', error)
    }
}
</script>
