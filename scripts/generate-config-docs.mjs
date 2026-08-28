#!/usr/bin/env node
/**
 * Generate the `ModuleOptions` block in docs/configuration.md from the TypeScript
 * source of truth.
 *
 * The block used to be hand-maintained, which meant it was a second copy of a
 * type that kept changing: it documented a `file` option the resolver treats as
 * removed, typed `public.endpoint` as `string` when `false` is load-bearing,
 * declared a `public.serverModule` nothing read, and omitted `verbose`,
 * `logLevel`, `spans`, `context` and `metrics` entirely.
 *
 * Generation is the fix rather than a CI diff check: a check reports drift after
 * it happens, generation prevents it.
 *
 * Run: `node scripts/generate-config-docs.mjs`
 * Check (CI): `node scripts/generate-config-docs.mjs --check`
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'src/runtime/shared/types/module-options.ts')
const TARGET = join(root, 'docs/configuration.md')

const START = '<!-- GENERATED:module-options START -->'
const END = '<!-- GENERATED:module-options END -->'

const source = await readFile(SOURCE, 'utf8')

const match = source.match(/export interface ModuleOptions \{[\s\S]*?\n\}/)
if (!match) {
    console.error('Could not find `export interface ModuleOptions` in', SOURCE)
    process.exit(1)
}

const block = [
    '```ts',
    '// Generated from src/runtime/shared/types/module-options.ts',
    '// Run `node scripts/generate-config-docs.mjs` after changing that file.',
    match[0],
    '```',
].join('\n')

const doc = await readFile(TARGET, 'utf8')

const startIndex = doc.indexOf(START)
const endIndex = doc.indexOf(END)

if (startIndex === -1 || endIndex === -1) {
    console.error(`Could not find the ${START} / ${END} markers in`, TARGET)
    process.exit(1)
}

const next = doc.slice(0, startIndex + START.length)
    + '\n' + block + '\n'
    + doc.slice(endIndex)

if (next === doc) {
    console.log('docs/configuration.md is up to date.')
    process.exit(0)
}

if (process.argv.includes('--check')) {
    console.error(
        'docs/configuration.md is out of date with ModuleOptions.\n'
        + 'Run `node scripts/generate-config-docs.mjs` and commit the result.',
    )
    process.exit(1)
}

await writeFile(TARGET, next)
console.log('Regenerated the ModuleOptions block in docs/configuration.md.')
