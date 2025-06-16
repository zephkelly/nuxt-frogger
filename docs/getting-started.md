# Getting Started
This page will walk you through the basics of working with Frogger, the structure of logs, and how to create loggers for both client-side and server-side applications. Lets make your first log!

## Log Levels
Frogger uses [consola](https://github.com/unjs/consola) to ingest all logs, and therefore shares the same log levels:
::: info Consola's Log Levels
```ts
0: Fatal and Error
1: Warnings
2: Normal logs
3: Informational logs, success, fail, ready, start, ...
4: Debug logs
5: Trace logs
-999: Silent
+999: Verbose logs

* Frogger does not support the 'box' log level.
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

Each logger instance provides methods for creating logs of any [Log Level](#log-levels) by its name, such as `info`, `error`, `warn`, etc.

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
Always the first argument you pass when creating a log. It is a string that should be a human-readable message describing the event. It should **not** contain any dynamic data. That's what the **ctx** field is for. This will also be printed to the console if you have console output enabled.

```ts
logger.info('User logged in',  // [!code focus]
    {
        userId: '12345',
        userName: 'john_doe',
        sessionId: 'abcde-12345-fghij-67890',
    }
);
```

And in your terminal or console:
```bash
ℹ️ [info] User logged in
[2023-11-14T12:00:00.000Z]
```

### - `ctx`
Always the second argument passed to the log method. It can be an object of any shape containing any additional context to the log you would like.

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
Both client and server loggers implement the `IFroggerLogger` interface keeping your code consistent on front and back end.

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
Loggers can be configured on a per-instance basis by passing in options in its constructor.
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



## Adding Context
This is an example of adding context to your loggers. This will be appended to every log created by this logger.
```ts
const logger = useFrogger({
    context: {
        favouriteColor: 'blue',
    },
});
```

If you have already created a logger and want to add context to it, you can use the `addContext` method:

```ts
const logger = useFrogger();
logger.addContext({
    numberOfCats: 3,
    location: 'London',
});
```
`setContext` can be used to replace the context entirely, while addContext will merge the new context with exisiting context.

`clearContext` well... clears the context



## Child Loggers
You can create child loggers that inherit the context of their parent logger, but can also have their own context. This is useful for creating loggers that are specific to a certain part of your application, while still retaining the global context.

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
    sessionId: 'abcde-12345-fghij-67890',// From the child
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

However, if a user was to log-in with a different user ID, all child loggers would automatically update their context to reflect the new user ID in the parent logger:

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
Frogger supports the [W3C Trace Context standard](https://www.w3.org/TR/trace-context/), which allows you to trace requests across distributed systems via a `tracestate` and `traceparent` header.

Frogger takes it a step further by automatically generating trace and span IDs for every single log, allowing you to see the flow of logs through not just other applications, but within your own systems

It is for this reason why you should **NOT** create one logger instance that you share across your entire application. Instead, loggers when you need them and in places that you want to capture a specific event or series of events

::: tip
Creating a logger is cheap, so create a new logger for each component, route, or utility function.
:::

Each logger generates a unique trace and span ID, and each log you create will link to the previous one as its parent. All logs will share the same trace ID unless the `reset()` function has been called on the logger instance.


::: info General Logging Advice
Frogger is not a `console.log` replacement. You add Frogger into places you know are causing trouble, or where you want to capture specific events in your application.
:::