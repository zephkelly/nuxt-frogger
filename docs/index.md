---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Frogger"
  text: "The zero-setup logger for Nuxt"
  tagline: "A self-hosted logging solution that just works. Install and setup with one command, make your first log in minutes."
  actions:
    - theme: brand
      text: Install Frogger
      link: /installation

features:
  - title: ✨ Zero-Config
    details: Sit back and relax. Frogger works out of the box with sensible defaults. Need to change something? It's all configurable
  - title: ⚡ Websocket + Dashboard
    details: Built-in dashboard and auto-registered websocket handling. Add your own auth later. View logs in real-time, real fast!
  - title: 🌐 Universal Logging
    details: Auto-imported utilities for the client and server. SSR, CSR, SPA, or static sites. Frogger has you covered
  - title: 🏷️ Batched Operations
    details: Handle usage spikes by automatically batching logs on the server and client. Improve performance, reduce load
  - title: 🧹 PII Scrubbing
    details: Basic strategies to scrub English PII from logs out of the box. Need something more robust? Add your own scrubbing strategies
  - title: 🔎 W3C Trace Context
    details: Trace requests like a pro. Follow from client to server, across distributed systems, external services, and back again
  - title: 🚦 Rate Limiting
    details: Worried about excessive logs or malicious actors? Frogger has an in-built rate limiter to prevent abuse and keep your logs clean
  - title: 🔌 Extensible
    details: Global context, child loggers, pluggable client and server side reporters, and more. Frogger's fully flexible