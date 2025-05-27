# Installation Guide

## Install
To install the latest version of Frogger, navigate to your Nuxt project and run the following command:

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

> [!NOTE]
> The latest version of Frogger is v0.0.2, you can view the [release here](https://github.com/zephkelly/nuxt-frogger/releases/tag/v0.0.2).

## Register module
After installation, add `'nuxt-frogger'` to your `nuxt.config.ts` file:

```ts
export default defineNuxtConfig({
    modules: [
        'nuxt-frogger'
    ],
    frogger: { /* Module options go here */ }
})
```

And that's it! Frogger is now installed and ready to use in your Nuxt applications. Take a look at the [Getting Started](./getting-started.md) guide to learn how to use Frogger effectively.