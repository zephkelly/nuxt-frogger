<template>
  <div class="card">
    <h3>{{ title }}</h3>
    <p>{{ myProp }}</p>
    <p class="card__meta">
      This component creates its <em>own</em> logger instance — so its logs form an
      independent trace span, separate from the page's logger.
    </p>
    <button class="btn" @click="logFromComponent">Log from this component</button>
  </div>
</template>

<script lang="ts" setup>
type Props = {
  title?: string
  myProp?: string
}

withDefaults(defineProps<Props>(), {
  title: 'Card Component',
  myProp: 'A self-contained component with its own logger.',
})

// One logger instance = one span. A component that owns its logger keeps its
// logs correlated to itself, not bundled in with the rest of the page.
const componentLogger = useFrogger({
  context: { component: 'Card' },
})

let clicks = 0
function logFromComponent() {
  clicks++
  componentLogger.info('Card button clicked', { clicks })
}
</script>

<style scoped>
.card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.1rem;
  background: var(--panel-2);
}
.card h3 { margin: 0 0 0.4rem; font-size: 1rem; }
.card p { margin: 0 0 0.6rem; color: var(--muted); font-size: 0.9rem; }
.card__meta { font-size: 0.82rem; }
</style>
