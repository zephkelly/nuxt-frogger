# Getting Started
Now that everything is installed and ready to go, it's time for you to make your first log!


## Log Levels
Frogger uses [consola](https://github.com/unjs/consola) to ingest all logs, meaning you can use *most of the same log levels you would use with consola:
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
```
*Frogger does not support the 'box' log level as this falls outside the scope of the library
:::

## Creating logs
Creating your first logger and log is easy! Frogger provides both client-side and server-side utilities you can use to create logger instances.

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

Each logger instance provides methods for creating any log type, such as `info`, `error`, `warn`, `debug`, etc.


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
Always the first argument you pass when creating a log. It is a string that should be a human-readable message describing the event. It should **not** contain any dynamic data. That's what the **ctx** field is for.

```ts
logger.info('User logged in'); // [!code focus]
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


The resulting log object would look something like:
```ts
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
        sampled: true,
    },
}
```

## Loggers
Both client and server loggers implement the `IFroggerLogger` interface keeping your code consistent on front and back end.

```ts
export interface IFroggerLogger {
    error(message: string, context?: Object): void;
    fatal(message: string, context?: Object): void;
    warn(message: string, context?: Object): void;
    log(message: string, context?: Object): void;
    info(message: string, context?: Object): void;
    success(message: string, context?: Object): void;
    fail(message: string, context?: Object): void;
    ready(message: string, context?: Object): void;
    start(message: string, context?: Object): void;
    debug(message: string, context?: Object): void;
    trace(message: string, context?: Object): void;
    silent(message: string, context?: Object): void;
    verbose(message: string, context?: Object): void;
    logLevel(level: LogType, message: string, context?: Object): void;

    addReporter(reporter: IFroggerReporter): void;
    removeReporter(reporter: IFroggerReporter): void;
    getReporters(): readonly IFroggerReporter[];
    clearReporters(): void;

    addContext(context: Object): void;
    setContext(context: Object): void;
    clearContext(): void;

    child(options: FroggerOptions): IFroggerLogger;
    reactiveChild(options: FroggerOptions): IFroggerLogger;

    getHeaders(customVendor?: string): Record<string, string>;
    reset(): void;
}
```

### Configuring loggers
Both loggers can be configured on a per-instance basis by passing in options when creating a logger
```ts
export interface FroggerOptions {
    context?: LogContext;
    scrub?: ScrubberOptions | boolean;
    consoleOutput?: boolean;
}
```

### Global Context
This is an example of adding global context to your loggers. This context will be appended to every log created, unless overridden by a specific log call.
```ts
const logger = useFrogger({
    context: {
        userId: '12345',
        sessionId: 'abcde-12345-fghij-67890',
    },
});
```


### Programmatically Log
In some cases, you may want to programmatically log at specific levels. You can do this using the `logLevel` method, which supports a string of LogLevel corresponding to the consola log level type:

```ts
logger.logLevel('error', 'This is an error at level 0');
logger.logLevel('fatal', 'This is a fatal log, also at level 0');

const currentLogLevel = ref('success');
logger.logLevel(currentLogLevel, 'This is a success log at level 3');
```


### Child Loggers
You can create child loggers that inherit the context of their parent logger, but can also have their own context. This is useful for creating loggers that are specific to a certain part of your application, while still retaining the global context.

```ts
const parentLogger = useFrogger({
    context: {
        userId: '12345',  // [!code focus]
    },
});

const childLogger = parentLogger.child({ // [!code focus]
    context: { // [!code focus]
        sessionId: 'abcde-12345-fghij-67890',  // [!code focus]
    }, // [!code focus]
}); // [!code focus]

childLogger.info('User logged in'); // [!code focus]
```
This will create a log with the context:

```ts
ctx: {
    userId: '12345',
    sessionId: 'abcde-12345-fghij-67890',
}
```


### Reactive Child Loggers
In some circumstances, you may want multiple loggers to share the same reactive context, so that changes made to a parent will be reflected in all children. You can do this by using the `reactiveChild` method:


## Trace Context
Frogger supports the W3C Trace Context standard, which allows you to trace requests across distributed systems. This is useful for debugging and understanding the flow of requests through your application.