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
    - theme: alt
      text: Getting Started
      link: /getting-started

features:
  - title: ✨ Zero Config
    details: Sit back and relax. With sensible defaults, Frogger works out of the box. Need to make changes? It's all configurable
  - title: ⚡ Websocket
    details: Get your logs broadcasted in realtime, build custom dashboards and live consoles, add your own auth anytime
  - title: 🌐 Universal Logging
    details: Auto-imported utilities for the client and server. SSR, CSR, SPA, or even static sites. Frogger works everywhere
  - title: 🏷️ Batched Operations
    details: Handle usage spikes with ease. Automated batching strategies on the server and client mean more performance, less stress
  - title: 🧹 PII Scrubbing
    details: Basic strategies to scrub PII from your logs configured by default. Need something more robust? Add your own custom strategies
  - title: 🔎 W3C Trace Context
    details: Trace requests on their journey. From client to the server, across distributed systems, external services, and back again
  - title: 🚦 Rate Limiting
    details: Worried about excessive logs or targeted attacks? Frogger rate-limits by default, reducing abuse and keeping the pond clean
  - title: 🔌 Extensible
    details: Child loggers, reactive context, pluggable client reporters, server transports. Frogger is built to handle almost any use case