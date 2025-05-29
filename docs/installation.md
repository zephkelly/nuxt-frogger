# Installation Guide

## Automatic Installation
To install and register the latest version of Frogger, navigate to your Nuxt project and run the following command:

::: code-group

```sh [pnpm]
$ pnpm dlx nuxi@latest module add nuxt-frogger
```

```sh [npm]
$ npx nuxi@latest module add nuxt-frogger
```

```sh [yarn]
$ yarn dlx nuxi@latest module add nuxt-frogger
```

```sh [bun]
$ bunx nuxi@latest module add nuxt-frogger
```
:::

And that's it! A default configuration of Frogger is now installed in your Nuxt project. Take a look at the [Getting Started](./getting-started.md) guide to learn how to make your first log.

Want to make some changes to Frogger's configuration? Check out the [Configuration](./configuration.md) guide.

## Manual Installation
Does the command above not work?
You can install Frogger and register it manually:

::: code-group

```sh [pnpm]
$ pnpm add nuxt-frogger
```

```sh [npm]
$ npm install nuxt-frogger
```

```sh [yarn]
$ yarn add nuxt-frogger
```

```sh [bun]
$ bun add nuxt-frogger
```
:::

### Register the Module
Add `'nuxt-frogger'` to `modules` in your `nuxt.config.ts` file.

```ts
export default defineNuxtConfig({
    modules: [
        'nuxt-frogger' // [!code ++]
    ]
})
```