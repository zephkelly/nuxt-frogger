# Installation

## Automatic Install
To install and register the latest version of Frogger run the following command:

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

A default configuration of Frogger is now installed in your Nuxt project. Take a look at the [Getting Started](./getting-started.md) guide to learn how to make your first log.

Want to make some changes to Frogger's configuration? Check out the [Configuration](./configuration.md) guide.

## Manual Install
Does command above not work?
To install Frogger and register it manually:

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
Add `'nuxt-frogger'` as a module in your `nuxt.config.ts` file.

```ts
export default defineNuxtConfig({
    modules: [
        'nuxt-frogger' // [!code ++]
    ]
})
```

## Recommended
While everything should work out of the box, I recommend at least setting up a name and version for your application that will be included in the logs. Set the `app` property in the `frogger` configuration object in your `nuxt.config.ts` file:

```ts
export default defineNuxtConfig({
    modules: [
        'nuxt-frogger'
    ],

    frogger: {
        app: {  
            name: 'My App',  // [!code ++]
            version: '1.0.0'  // [!code ++]
        } 
    } 
})
```

For more configuration options, check out the [Configuration](./configuration.md) guide.