import { defineBuildConfig } from 'unbuild'

/**
 * Extra build entries layered on top of @nuxt/module-builder's defaults (which
 * build `src/module` + `src/runtime`). unbuild concatenates these `entries` with
 * the builder's own, so the two testing subpaths ship as sibling mkdist outputs
 * under `dist/` — `dist/testing/*`, `dist/transport/*` and `dist/playwright/*`.
 *
 * mkdist (transpile-only, not rollup-bundled) is deliberate: it preserves the
 * relative `../runtime/*` imports so the subpaths reference the already-built
 * `dist/runtime` output instead of bundling a second copy, and leaves `#imports`
 * / peer-dep imports untouched for the consumer's runtime to resolve.
 */
export default defineBuildConfig({
    entries: [
        {
            builder: 'mkdist',
            input: 'src/testing/',
            outDir: 'dist/testing',
            ext: 'js',
            pattern: ['**', '!**/*.{spec,test}.{js,cts,mts,ts,jsx,tsx}'],
        },
        {
            builder: 'mkdist',
            input: 'src/transport/',
            outDir: 'dist/transport',
            ext: 'js',
            pattern: ['**', '!**/*.{spec,test}.{js,cts,mts,ts,jsx,tsx}'],
        },
        {
            builder: 'mkdist',
            input: 'src/playwright/',
            outDir: 'dist/playwright',
            ext: 'js',
            pattern: ['**', '!**/*.{spec,test}.{js,cts,mts,ts,jsx,tsx}'],
        },
    ],
    // Peer test tooling stays external — never bundled into the subpath output.
    externals: ['vitest', '@nuxt/test-utils', '@playwright/test'],
})
