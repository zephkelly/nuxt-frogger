import { defineVitestConfig } from '@nuxt/test-utils/config'
import { resolve } from 'path'

export default defineVitestConfig({
    test: {
        globals: true,
        environment: 'node',
        include: [
            "test/**/*.test.ts",
        ],
        coverage: {
            enabled: true,
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*'],
            exclude: ['**/index.d.ts'],
        },
        exclude: ['node_modules/**/*', 'playground/**/*'],
        server: {
            deps: {
                inline: [
                    '#imports'
                ]
            }
        }
    }
})