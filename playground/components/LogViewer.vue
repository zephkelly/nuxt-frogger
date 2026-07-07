<template>
  <div class="log-viewer">
    <div class="log-viewer__head">
      <span class="log-viewer__count">{{ logs.length }} log{{ logs.length === 1 ? '' : 's' }}</span>
      <button class="btn" @click="$emit('clear')">Clear</button>
    </div>

    <div v-if="logs.length === 0" class="log-viewer__empty">
      No logs yet. Trigger some from another tab/page and they'll stream in here.
    </div>

    <ol v-else class="log-viewer__list">
      <li v-for="(log, i) in logs" :key="i" class="log-row" :class="`lvl-${levelGroup(log.lvl)}`">
        <span class="log-row__type">{{ log.type }}</span>
        <span class="log-row__msg">{{ log.msg }}</span>
        <span v-if="log.source?.name" class="log-row__src">{{ log.source.name }}</span>
        <span class="log-row__env">{{ log.env }}</span>
        <details v-if="hasCtx(log)" class="log-row__ctx">
          <summary>ctx</summary>
          <pre>{{ pretty(log.ctx) }}</pre>
        </details>
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
// Presentational only — the parent owns the WebSocket and passes parsed logs in.
interface IncomingLog {
  lvl: number
  type: string
  msg: string
  ctx?: Record<string, any>
  env?: string
  source?: { name?: string; version?: string }
}

defineProps<{ logs: IncomingLog[] }>()
defineEmits<{ clear: [] }>()

function levelGroup(lvl: number): string {
  if (lvl <= 0) return 'error'
  if (lvl === 1) return 'warn'
  if (lvl >= 4) return 'debug'
  return 'info'
}

function hasCtx(log: IncomingLog): boolean {
  return !!log.ctx && Object.keys(log.ctx).length > 0
}

function pretty(ctx: unknown): string {
  try {
    return JSON.stringify(ctx, null, 2)
  } catch {
    return String(ctx)
  }
}
</script>

<style scoped>
.log-viewer {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #0b0d11;
  overflow: hidden;
}
.log-viewer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.log-viewer__count { color: var(--muted); font-size: 0.82rem; }
.log-viewer__empty { padding: 1.25rem; color: var(--muted); font-size: 0.88rem; }

.log-viewer__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 420px;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82rem;
}
.log-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid #15181f;
}
.log-row__type {
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  padding: 0.05rem 0.4rem;
  border-radius: 4px;
  background: var(--panel-2);
  color: var(--muted);
}
.lvl-error .log-row__type { background: #3a1620; color: #ff8aa0; }
.lvl-warn .log-row__type { background: #3a2f12; color: #ffd166; }
.lvl-info .log-row__type { background: #15331c; color: #7bc242; }
.lvl-debug .log-row__type { background: #1b2433; color: #7aa2ff; }

.log-row__msg { flex: 1; color: var(--text); min-width: 12ch; }
.log-row__src, .log-row__env { color: var(--muted); font-size: 0.72rem; }
.log-row__ctx { flex-basis: 100%; }
.log-row__ctx summary { cursor: pointer; color: var(--muted); }
.log-row__ctx pre {
  margin: 0.4rem 0 0;
  padding: 0.5rem;
  background: #11141a;
  border-radius: 6px;
  overflow-x: auto;
  color: #cfd6e0;
}
</style>
