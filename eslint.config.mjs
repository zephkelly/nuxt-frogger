// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

// Run `npx @eslint/config-inspector` to inspect the resolved config interactively
export default createConfigForNuxt({
  features: {
    // Rules for module authors
    tooling: true,
    // Rules for formatting
    stylistic: true,
  },
  dirs: {
    src: [
      './playground',
    ],
  },
})
  .append(
    {
      // The runtime reads its config through `useFroggerConfig()` /
      // `useFroggerServerConfig()`, which are typed against the same
      // declaration `module.ts` writes. A new `@ts-ignore` here is almost
      // always a cast around that contract - and casting around it is how a
      // documented option ends up with zero readers.
      files: ['src/runtime/**/*.ts'],
      rules: {
        '@typescript-eslint/ban-ts-comment': ['error', {
          'ts-ignore': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        }],
      },
    },
  )
