---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Frogger"
  text: "The zero setup logger for Nuxt"
  tagline: "Log and trace anywhere in your apps. SSR or SPA, it just works."
  actions:
    - theme: brand
      text: Install Frogger
      link: /installation
    - theme: alt
      text: Getting Started
      link: /getting-started

features:
  - title: Universal Logging
    details: Call Frogger from your server or client code. SSR, SPA, or even static sites, it just works.
  - title: Tracing Utils
    details: The W3C Trace Context standard lets you track requests across your app and external services. 
  - title: Automatic Batching
    details: Logs created on the server or client are batched and queued, reducing the load on your server.
  - title: Endpoint Registration
    details: Frogger auto-registers your endpoints. Had somewhere else in mind? Just override it.
---

