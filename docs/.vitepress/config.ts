import { defineConfig } from 'vitepress'
import { groupIconMdPlugin, groupIconVitePlugin } from 'vitepress-plugin-group-icons'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "🐸 Frogger",
  description: "A logging and tracing library for Nuxt apps",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Installation', link: '/installation' }
    ],

    sidebar: [
      {
        text: 'Examples',
        items: [
          { text: 'Markdown Examples', link: '/markdown-examples' },
          { text: 'Runtime API Examples', link: '/api-examples' }
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
