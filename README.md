# 🐸 Frogger

### The zero-setup logger for Nuxt

Log and trace from anywhere in your Nuxt applications. Server to client, client to server, to external services and back again. Install Frogger - add it as a module, and it just works. Automatically batches and sends logs to the server, storing them in formatted json files. No matter where you make a log, you'll find it in the same place.

## Installation

### Automatic Installation

To install and register the latest version of Frogger, navigate to your Nuxt project and run the following command:

**pnpm:**
```sh
pnpm dlx nuxi@latest module add nuxt-frogger
```

**npm:**
```sh
npx nuxi@latest module add nuxt-frogger
```

### Manual Installation

Does the command above not work? You can install Frogger and register it manually:

**pnpm:**
```sh
pnpm add nuxt-frogger
```

**npm:**
```sh
npm install nuxt-frogger
```

### Register the Module

Add `'nuxt-frogger'` to `modules` in your `nuxt.config.ts` file:

```ts
export default defineNuxtConfig({
    modules: [
        'nuxt-frogger'
    ]
})
```