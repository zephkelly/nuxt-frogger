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
            { text: 'Installation', link: '/installation' }
        ],

        sidebar: [
            {
                text: 'Overview',
                items: [
                { text: 'Installation', link: '/installation' },
                { text: 'Configuration', link: '/configuration' }
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
