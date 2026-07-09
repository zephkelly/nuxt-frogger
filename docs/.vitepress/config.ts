import { defineConfig } from 'vitepress'
import { groupIconMdPlugin, groupIconVitePlugin } from 'vitepress-plugin-group-icons'



export default defineConfig({
    base: '/nuxt-frogger/',
    lang: 'en-US',
    title: "🐸 Frogger",
    description: "A logging and tracing library for Nuxt apps",
    themeConfig: {
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Getting Started', link: '/getting-started' },
            { text: 'Guides', link: '/guides/live-logs' },
            { text: 'Reference', link: '/reference/logger-api' },
        ],

        sidebar: [
            {
                text: 'Introduction',
                items: [
                    { text: 'Why Frogger', link: '/why-frogger' },
                    { text: 'Installation', link: '/installation' },
                    { text: 'Getting Started', link: '/getting-started' },
                ]
            },
            {
                text: 'Configuration',
                items: [
                    { text: 'Configuration', link: '/configuration' },
                ]
            },
            {
                text: 'Guides',
                items: [
                    { text: 'Live Logs (WebSocket)', link: '/guides/live-logs' },
                    { text: 'Scrubbing & PII', link: '/guides/scrubbing' },
                    { text: 'Rate Limiting', link: '/guides/rate-limiting' },
                    { text: 'Error Capture', link: '/guides/error-capture' },
                    { text: 'Transports & HttpTransport', link: '/guides/transports' },
                    { text: 'Testing', link: '/guides/testing' },
                ]
            },
            {
                text: 'Reference',
                items: [
                    { text: 'Logger API', link: '/reference/logger-api' },
                    { text: 'Log Levels', link: '/reference/log-levels' },
                ]
            }
        ],

        socialLinks: [
            { icon: 'github', link: 'https://github.com/zephkelly/nuxt-frogger' }
        ]
    },
    markdown: {
        config: (md) => {
            md.use(groupIconMdPlugin)
        }
    },
    vite: {
        plugins: [
            //@ts-ignore
            groupIconVitePlugin()
        ],
    }
})
