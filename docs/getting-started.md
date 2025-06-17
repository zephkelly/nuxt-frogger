# Getting Started
This page will walk you through the basics of working with Frogger, the structure of logs, and how to create loggers for both client-side and server-side applications. Lets make your first log!

::: info General Logging Advice
Frogger is not a `console.log` replacement. You add Frogger into places you know are causing trouble, and where you want to capture specific events in your application.
:::

## Log Levels
Frogger uses [consola](https://github.com/unjs/consola) to ingest all logs, and therefore shares the same log levels:
::: info Consola's Log Levels
```bash
0: Fatal and Error
1: Warnings
2: Normal logs
3: Informational logs, success, fail, ready, start, ...
4: Debug logs
5: Trace logs
-999: Silent
+999: Verbose logs

*Frogger does not support consolas 'box' log level.
```
:::

## Creating logs
Before we can create a log, we need to create a logger. Frogger provides both client-side and server-side utilities you can use to create logger instances.

### Client-side Logging
In your app code, use the auto-imported `useFrogger` composable:
```vue
<script setup lang="ts">

const logger = useFrogger(); // [!code focus]
logger.info('Hello, Client Frogger!'); // [!code focus]

</script>
```

### Server-side Logging
In your server routes and utilities, use the auto-imported `getFrogger` function:

```ts
export default defineEventHandler(async (event) => {

    const logger = getFrogger(); // [!code focus]
    logger.info('Hello, Server Frogger!'); // [!code focus]

});
```

Each logger instance provides methods for creating logs of any [Log Level](#log-levels) by its name, such as `info`, `error`, `warn`, etc. Check out the [loggers](#loggers) section for more details.

### Programmatic Logging
In some cases, you may want to dynamically generate logs of different levels. You can do this using the `logLevel` method, which supports a string corresponding to the type of consola [log level](#log-levels)

```ts
logger.logLevel('error', 'This is an error at level 0');
logger.logLevel('fatal', 'This is a fatal log, also at level 0');

// Basic example
const currentLogLevel = ref('success');
logger.logLevel(currentLogLevel, 'This is a success log at level 3');

currentLogLevel.value = 'info'; // Change log level to info
logger.logLevel(currentLogLevel, 'This is an info log at level 2');
```



## Log Anatomy
Frogger is opinionated about the structure of its logs to ensure consistency and to make it as easy to pick up and use as possible.

``` ts
export interface LoggerObject {
    time: number;
    lvl: number;
    type: LogType;
    msg: string;
    ctx: LogContext;
    tags?: string[];
    env: 'ssr' | 'csr' | 'client' | 'server';
    source?: {
        name: string;
        version: string;
    };
    trace: TraceContext;
}
```
The fields we are most interested in for now are `msg` and `ctx`.

### - `msg` 
Always the first argument you pass when creating a log. It is a string that should be a human-readable message describing the event. It should **not** contain any dynamic data. That's what the **ctx** field is for. This will also be printed to the console if you have console output enabled:

```ts
logger.info('User logged in',  // [!code focus]
    {
        userId: '12345',
        userName: 'john_doe',
        sessionId: 'abcde-12345-fghij-67890',
    }
);
```

And in your terminal or console you will see something like:
```bash
ℹ️ [info] User logged in
[2023-11-14T12:00:00.000Z]
```

### - `ctx`
Always the second argument passed to the log method. It can be an object of any shape containing any additional context to the log you would like:

```ts
logger.info('User logged in', 
    { // [!code focus]
        userId: '12345', // [!code focus]
        userName: 'john_doe', // [!code focus]
        sessionId: 'abcde-12345-fghij-67890', // [!code focus]
    } // [!code focus]
);
```

::: details Click here to see the full log object
``` json
{
    time: 1700000000000,
    lvl: 2,
    type: 'info',
    msg: 'User logged in',
    ctx: {
        userId: '12345',
        userName: 'john_doe',
        sessionId: 'abcde-12345-fghij-67890',
    },
    tags: [],
    env: 'csr',
    source: {
        name: 'my-nuxt-app',
        version: '1.0.0',
    },
    trace: {
        traceId: '123e4567-e89b-12d3-a456-426614174000',
        parentId: '123e4567-e89b-12d3-a456-426614174001',
        spanId: '123e4567-e89b-12d3-a456-426614174002',
        flags: []
    },
}
```
:::



## Loggers
Both client and server loggers implement the `IFroggerLogger` interface keeping your code consistent on front and back end:

```ts
export interface IFroggerLogger {
    error(msg: string, ctx?: Object): void;
    fatal(msg: string, ctx?: Object): void;
    warn(msg: string, ctx?: Object): void;
    log(msg: string, ctx?: Object): void;
    info(msg: string, ctx?: Object): void;
    success(msg: string, ctx?: Object): void;
    fail(msg: string, ctx?: Object): void;
    ready(msg: string, ctx?: Object): void;
    start(msg: string, ctx?: Object): void;
    debug(msg: string, ctx?: Object): void;
    trace(msg: string, ctx?: Object): void;
    silent(msg: string, ctx?: Object): void;
    verbose(msg: string, ctx?: Object): void;
    logLevel(level: LogType, msg: string, ctx?: Object): void;

    addReporter(reporter: IFroggerReporter): void;
    removeReporter(reporter: IFroggerReporter): void;
    getReporters(): readonly IFroggerReporter[];
    clearReporters(): void;

    addContext(ctx: Object): void;
    setContext(ctx: Object): void;
    clearContext(): void;

    child(options: FroggerOptions): IFroggerLogger;
    reactiveChild(options: FroggerOptions): IFroggerLogger;

    getHeaders(customVendor?: string): Record<string, string>;
    reset(): void;
}
```

### Configuring loggers
Loggers can be configured on a per-instance basis by passing in options in its constructor:
```ts
export interface FroggerOptions {
    context?: LogContext;
    scrub?: {
        maxDepth?: number;
        deepScrub?: boolean;
        preserveTypes?: boolean;
        rules?: ScrubRule[];
    } | boolean;
    consoleOutput?: boolean;
}
```

Here are some usage examples:
```ts
// Client-side
const logger = useFrogger({
    consoleOutput: true,
});

// Server-side
const logger = getFrogger({
    scrub: {
        maxDepth: 3,
        deepScrub: true,
    },
});
```



## Adding Context
This is an example of adding context to your loggers. This will be appended to every log created by this logger:
```ts
const logger = useFrogger({
    context: {
        favouriteColor: 'blue',
    },
});

logger.log('User logged in', {
    userId: '12345',
    userName: 'john_doe',
});

// This will log:
// {
//     ...,
//     msg: 'User logged in',
//     ctx: {
//         favouriteColor: 'blue', // From the logger context
//         userId: '12345',
//         userName: 'john_doe',
//     },
//     ...
```

If you'd like to add context to an existing logger, you can use the `addContext` method, this will use `defu` to merge the existing and incoming contexts together:

```ts
const logger = useFrogger();

logger.addContext({
    numberOfCats: 3,
    location: 'London',
});
```

### Additional Methods
You can replace a loggers context entirely with the `setContext` method:
```ts
setContext(ctx: Object): void;
```

Or you can remove all context with the `clearContext` method:
```ts
clearContext(): void;
```



## Child Loggers
You can create child loggers that inherit the context of their parent while still containing their own internal context:

```ts
const parentLogger = useFrogger({
    context: {
        userId: '12345', 
    },
});

const childLogger = parentLogger.child({
    context: {
        sessionId: 'abcde-12345-fghij-67890',
    },
});

childLogger.info('User logged in');
```
This will create a log with the context:

```ts
ctx: { 
    userId: '12345', // From the parent  
    sessionId: 'abcde-12345-fghij-67890' // From the child
}
```


### Reactive Child Loggers
In some circumstances, you may want multiple loggers to share the same reactive context, so that changes made to a parent will be reflected in all children. You can do this by using the `reactiveChild` method:

```ts
const parentLogger = useFrogger({
    context: {
        userId: '12345',
    },
});
const childLogger = parentLogger.reactiveChild({
    context: {
        sessionId: 'abcde-12345-fghij-67890',
    },
});

childLogger.info('User logged in');
```

This will create a log with the same context as the previous example:

```ts
ctx: {
    userId: '12345', // From the parent
    session: 'abcde-12345-fghij-67890',
}
```

However, say a user logged in with a different user ID and the parent logger had its context updated, all child loggers would automatically update their context to reflect this:

```ts
parentLogger.setContext({
    userId: '67890', // [!code ++]
});
```

This will result in the child logger's context being updated to:

```ts
ctx: {
    userId: '67890', // Updated from the parent // [!code ++]
    sessionId: 'abcde-12345-fghij-67890',
}
```


## Trace Context
Frogger supports the [W3C Trace Context standard](https://www.w3.org/TR/trace-context/), which allows you to trace requests across distributed systems via `tracestate` and `traceparent` headers. Any Nuxt application that uses Frogger will automatically parse these headers:

```http
traceparent: '00-70729f2d10910d20c8a0ba9d34d09912-79d6a5bfe9349090-01'
tracestate: 'frogger=2c615d534779d87b'
```

### Adding Trace Context to Requests
Frogger will generate these headers for you, however you need to ensure that you pass the headers along with any requests you make to other services, or even to your own backend if you would like to follow requests from the client to the server:

```ts
const logger = useFrogger();

const response = await $fetch('/api/some-endpoint', { 
    headers: logger.getHeaders(), // [!code ++]
});
```
::: details View server-side example
```ts
const logger = getFrogger();

const response = await $fetch('https://api.example.com/data', { 
    headers: logger.getHeaders(), // [!code ++]
});
```
:::

In the above example, the `getHeaders()` method will generate two headers: `traceparent` and `tracestate`.

### - `traceparent`
To follow a request from one service to another, Frogger generates a `traceparent` header that contains the trace ID, parent ID, and flags:
```http
// In the format: {version}-{trace ID}-{parent ID}-{flags}
traceparent: '00-70729f2d10910d20c8a0ba9d34d09912-79d6a5bfe9349090-01'
```

### - `tracestate`
The second header is `tracestate`, which lets you add additional vendor-specific trace information to request. This is useful to identify which systems the trace passed through. Frogger uses your `app.name` as the vendor and `app.version` from your module options as the trace data by default:

```http
// In the format: {vendor}={trace data}
tracestate: 'my-app-name=my-app-version'
```
Each service will then prepend its own trace data to the request (systems using Frogger handle this automatically), allowing you to trace the request as it passes through multiple systems:

```http
tracestate: 'my-app-name=my-app-version,my-other-service=12345-67890'
```

You can also customise it per-request by setting the `vendor` and `traceData` fields when calling `getHeaders()`:
```ts
const logger = useFrogger();

const response = await $fetch('/api/some-endpoint', {
    headers: logger.getHeaders({
        vendor: 'my-custom-vendor', // [!code ++]
        traceData: 'my-custom-trace-data-12345', // [!code ++]
    })
});

// This will generate the following tracestate header:
// tracestate: 'my-custom-vendor=my-custom-trace-data-12345'
```

## Client to Server
We have seen how to add trace context to outgoing request, but what about incoming request? Frogger handles this for use by taking advantage of Nuxt's experimental `asyncData` feature, which allows Frogger's loggers to automatically grab the incoming request event without needing to pass it around manually.

```ts
export default defineEventHandler(async (event) => {
    const logger = getFrogger(); // getFrogger will capture the incoming event
    logger.info('Incoming request');
});
```

Don't want to use experimental features? No problem! You can disable this at any time with the `autoEventCapture` option in your module options:

```ts
export default defineNuxtConfig({
    modules: [
        'frogger'
    ],
    frogger: {
        serverModule: {
            autoEventCapture: false, // [!code ++]
        }
    }
});
```

However, you will now need to pass the event to `getFrogger` manually for each server-side logger you create:

```ts
export default defineEventHandler(async (event) => {
    const logger = getFrogger(event); // pass in the request
    logger.info('Incoming request');
});
```

When you create a logger using `getFrogger`, it will automatically parse the incoming `traceparent` and `tracestate` headers, allowing you to continue tracing requests between your front and back end.

This means, the last log created on the client will be the **parent** of the first log created on the server. And vice versa.


### Application Tracing
Frogger takes tracing a step further by automatically generating trace and span IDs for every log made, linking logs together that are created from the same logger instance. This means you can trace events throughout your own applications, as well as across distributed systems.

This is why you should **NOT** create one logger instance that is shared across your entire application. Instead, create loggers via the `useFrogger` and `getFrogger` as you need them.

::: tip
Creating a logger is cheap, so you can make new loggers for each component, route, or utility function.
:::