<template>
  <div>
    <h1 class="page-title">Scrubbing</h1>
    <p class="page-intro">
      Frogger scrubs PII from your logs before they're stored — but scrubbing is fully opt-in: you
      compose rules from the provided strategies and field-name lists. This playground opts into the
      <code>RECOMMENDED_RULES</code> bundle, so fields like <code>password</code>, <code>email</code>,
      <code>phone</code> and <code>creditCard</code> are masked, redacted, or hashed. The redaction
      happens server-side on the stored record; log the object below and inspect
      <code>playground/logs/</code> to see the result.
    </p>

    <section class="demo-section">
      <h2>Log an object full of PII</h2>
      <p>This client log includes sensitive fields. They'll be scrubbed before being written to disk.</p>
      <pre class="sample">{{ samplePretty }}</pre>
      <div class="demo-actions">
        <button class="btn btn-primary" @click="logFromClient">Log it (client)</button>
        <button class="btn" @click="logFromServer">Log it (server) — GET /api/demo/scrub</button>
      </div>
      <p v-if="serverResult" class="hint">Server returned the scrubbed record: <code>see console</code></p>
    </section>

    <section class="demo-section">
      <h2>Composing rules</h2>
      <p>
        Build your own rule set in <code>frogger.config.ts</code> with the <code>defineScrub()</code>
        builder — one method per strategy (<code>redact</code>, <code>maskEmail</code>,
        <code>keepEnds</code>, <code>maskCard</code>, …), field arguments as literal names, a RegExp,
        or a provided field-name list.
      </p>
      <pre class="sample">{{ customRuleExample }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const sample = {
  userId: 'u_98217',
  email: 'jane.doe@example.com',
  phone: '+1 (555) 123-4567',
  password: 'hunter2',
  apiKey: 'sk_live_5fThisShouldNeverAppear',
  creditCard: '4111 1111 1111 1111',
  fullName: 'Jane Doe',
  order: { total: 4999, currency: 'USD' },
}

const samplePretty = JSON.stringify(sample, null, 2)

const customRuleExample = `// frogger.config.ts
import { defineScrub, fields, RECOMMENDED_RULES } from '#frogger/config'

scrub: defineScrub()
  .use(...RECOMMENDED_RULES)              // sensible baseline
  .redact('authToken', /.*secret.*/i)    // app-specific secrets
  .maskEmail(fields.emails)
  .build()`

const logger = useFrogger({ context: { page: 'scrubbing' } })
function logFromClient() {
  logger.info('user profile (with PII)', sample)
}

const serverResult = ref(false)
async function logFromServer() {
  const res = await $fetch('/api/demo/scrub')
  serverResult.value = true
  console.log('Scrubbed record from server:', res)
}
</script>

<style scoped>
.sample {
  margin: 0 0 0.9rem;
  padding: 0.75rem;
  background: #0b0d11;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.8rem;
  color: #cfd6e0;
}
</style>
