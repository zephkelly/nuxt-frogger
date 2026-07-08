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
    link: /installation
    linkText: Install
  - title: ⚡ Websocket
    details: "Opt-in dev live-stream — flip on with frogger: { websocket: true } (or preset: 'full'). Broadcast logs in realtime, build custom dashboards and live consoles, add your own auth anytime"
    link: /guides/live-logs
    linkText: Live Logs
  - title: 🌐 Universal Logging
    details: Auto-imported utilities for the client and server. SSR, CSR, SPA, or even static sites. Frogger works everywhere
    link: /getting-started
    linkText: Getting Started
  - title: 🏷️ Batched Operations
    details: Handle usage spikes with ease. Automated batching strategies on the server and client mean more performance, less stress
    link: /configuration
    linkText: Configure batching
  - title: 🧹 PII Scrubbing
    details: "Fully opt-in PII scrubbing: compose rules from built-in strategies and field-name lists with the defineScrub() builder, or pull in the RECOMMENDED_RULES bundle for sensible coverage."
    link: /guides/scrubbing
    linkText: Scrubbing
  - title: 🔎 W3C Trace Context
    details: Trace requests on their journey. From client to the server, across distributed systems, external services, and back again
    link: /getting-started#trace-context
    linkText: Trace Context
  - title: 🚦 Rate Limiting
    details: "Worried about excessive logs or targeted attacks? Opt-in rate limiting reduces abuse, flip on with frogger: { rateLimit: true } to keep the pond clean"
    link: /guides/rate-limiting
    linkText: Rate Limiting
  - title: 🔌 Extensible
    details: Child loggers, reactive context, pluggable client reporters, server transports. Frogger is built to handle almost any use case
    link: /guides/transports
    linkText: Transports