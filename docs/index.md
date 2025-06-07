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
  - title: ✨ Zero Config
    details: Sit back and relax. With sensible defaults, Frogger works out of the box. Need to make changes? It's all configurable
  - title: ⚡ Websocket + Dashboard
    details: Built-in dashboard and auto-registered websocket pipeline. Add your own auth anytime. Squash bugs real-time, real fast!
  - title: 🌐 Universal Logging
    details: Auto-imported utilities for the client and server. SSR, CSR, SPA, even static sites. Unhandled errors? Already logged them
  - title: 🏷️ Batched Operations
    details: Handle usage spikes with ease. Automated batching strategies on the server and client mean more performance, less stress
  - title: 🧹 PII Scrubbing
    details: Basic strategies to scrub PII from your logs configured by default. Need something more robust? Add your own custom strategies
  - title: 🔎 W3C Trace Context
    details: Trace requests wherever they go. From the client to server, across distributed systems, external services, and back again
  - title: 🚦 Rate Limiting
    details: Worried about excessive logs or targeted attacks? Frogger rate-limits by default, reducing abuse and keeping the pond clean
  - title: 🔌 Extensible
    details: Hooks, child loggers, reactive context, client and server side pluggable reporters. Everything production-grade apps need