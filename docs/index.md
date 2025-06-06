---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Frogger"
  text: "The zero-setup logger for Nuxt"
  tagline: "Log and trace anywhere from anywhere in your apps. SSR, CSR, SPA, SSG, it just works."
  actions:
    - theme: brand
      text: Install Frogger
      link: /installation

features:
#   - title: Websocket + Dashboard
#     details: A native websocket handler, and built-in dashboard components let you view logs in real-time, real fast!
  - title: Universal Logging
    details: Call useFrogger() in your app code, or getFrogger() in your server routes. Log anywhere, anytime.
  - title: Tracing Utils
    details: Fogger follows the W3C Trace Context standard. Follow requests from client to server, or even to external services. 
  - title: Batched Operations
    details: Logs on the client are batched before posting. Logs on the server are batched before being written or posted externally.
  - title: Auto-Registration
    details: Let Frogger handle the setup. Endpoints, plugins, composables, and middleware. Don't want a feature? Just disable it.
---

