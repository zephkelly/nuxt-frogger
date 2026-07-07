<template>
  <div class="frogger-app">
    <header class="topbar">
      <div class="brand">🐸 <span>Frogger Playground</span></div>
      <nav class="nav">
        <NuxtLink to="/" class="nav-link">Overview</NuxtLink>
        <NuxtLink to="/client-logging" class="nav-link">Client Logging</NuxtLink>
        <NuxtLink to="/ambient" class="nav-link">Ambient</NuxtLink>
        <NuxtLink to="/trace-context" class="nav-link">Trace Context</NuxtLink>
        <NuxtLink to="/live-logs" class="nav-link">Live Logs</NuxtLink>
        <NuxtLink to="/error-capture" class="nav-link">Error Capture</NuxtLink>
        <NuxtLink to="/scrubbing" class="nav-link">Scrubbing</NuxtLink>
      </nav>
    </header>

    <main class="content">
      <NuxtPage />
    </main>

    <footer class="footer">
      Open your <strong>browser console</strong>, the <strong>Network</strong> tab
      (look for <code>POST /api/_frogger/logs → 200</code>), and your terminal to
      watch logs flow. Server logs are written to <code>playground/logs/</code>.
    </footer>
  </div>
</template>

<script setup lang="ts">
// This component is just the nav shell. Each demo lives under `pages/`.
</script>

<style>
:root {
  --frog-green: #659c2a;
  --frog-green-bright: #41a918;
  --bg: #0f1115;
  --panel: #171a21;
  --panel-2: #1e222b;
  --border: #2a2f3a;
  --text: #e6e8ec;
  --muted: #9aa3b2;
  --accent: #7bc242;
}

* { box-sizing: border-box; }

html, body, #__nuxt {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.5;
}

.frogger-app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.75rem 1.25rem;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 10;
  flex-wrap: wrap;
}

.brand {
  font-weight: 700;
  font-size: 1.05rem;
  white-space: nowrap;
}
.brand span { color: var(--accent); }

.nav {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.nav-link {
  color: var(--muted);
  text-decoration: none;
  padding: 0.35rem 0.7rem;
  border-radius: 6px;
  font-size: 0.9rem;
}
.nav-link:hover { color: var(--text); background: var(--panel-2); }
.nav-link.router-link-active {
  color: #fff;
  background: var(--frog-green);
}

.content {
  flex: 1;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
}

.footer {
  border-top: 1px solid var(--border);
  padding: 1rem 1.25rem;
  color: var(--muted);
  font-size: 0.85rem;
  text-align: center;
}

/* ---- shared demo primitives ---- */
.page-title { font-size: 1.6rem; margin: 0 0 0.25rem; }
.page-intro { color: var(--muted); margin: 0 0 1.5rem; max-width: 60ch; }

.demo-section {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.1rem 1.25rem;
  margin-bottom: 1.25rem;
}
.demo-section h2 { margin: 0 0 0.35rem; font-size: 1.1rem; }
.demo-section p { margin: 0 0 0.9rem; color: var(--muted); font-size: 0.92rem; }

.demo-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }

.btn {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
  padding: 0.45rem 0.85rem;
  border-radius: 7px;
  font-size: 0.88rem;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.btn:hover { border-color: var(--accent); }
.btn-primary { background: var(--frog-green); border-color: var(--frog-green); color: #fff; }
.btn-primary:hover { background: var(--frog-green-bright); border-color: var(--frog-green-bright); }
.btn-danger { border-color: #5a2330; color: #ff8aa0; }
.btn-danger:hover { border-color: #ff8aa0; }

.hint {
  margin-top: 0.9rem;
  font-size: 0.82rem;
  color: var(--muted);
  border-left: 2px solid var(--frog-green);
  padding-left: 0.7rem;
}

code {
  background: var(--panel-2);
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  font-size: 0.85em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

a { color: var(--accent); }
</style>
