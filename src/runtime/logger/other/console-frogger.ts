import { type ConsolaInstance, createConsola } from "consola/core";
import { ConsoleReporter } from "../_reporters/console-reporter";
import { froggerInternal } from "../../shared/utils/internal-log";
import { uuidv7 } from "../../shared/utils/uuid";

import type { LogObject, LogType } from 'consola';
import type { LoggerObject } from "../../shared/types/log";
import { levelOf, severityOf } from "../../shared/types/log";
import type { IFroggerLogger, AddContextOptions } from "../types";
import type { IFroggerReporter } from "../_reporters/types";
import type { LogContext } from "../../shared/types/log";
import type { TraceContext } from "../../shared/types/trace-headers";
import type { FroggerOptions } from "../../shared/types/options";

export interface SimpleLoggerOptions {
    level?: number;
    context?: LogContext;
    consoleOutput?: boolean;
}



/**
 * Simple console-only logger
 */
export class SimpleConsoleLogger implements IFroggerLogger {
    protected consola: ConsolaInstance;
    protected globalContext: LogContext = {};
    protected level: number;

    private consoleReporter: ConsoleReporter | undefined;
    private customReporters: IFroggerReporter[] = [];

    constructor(options: SimpleLoggerOptions = {}) {
        this.level = options.level ?? 3;

        if (options.consoleOutput !== false) {
            this.consoleReporter = new ConsoleReporter();
        }

        this.consola = createConsola({
            level: this.level
        });

        this.consola.addReporter({
            log: async (logObj: LogObject) => {
                await this.handleLog(logObj);
            }
        });

        if (this.consoleReporter !== undefined) {
            this.consola.addReporter({
                log: (logObj: LogObject) => {
                    try {
                        this.consoleReporter?.log(logObj as unknown as LoggerObject);
                    }
                    catch (err) {
                        console.log(`[${logObj.type.toUpperCase()}]`, logObj.args?.[0] || '', ...logObj.args?.slice(1) || []);
                    }
                }
            });
        }

        if (options.context) {
            this.globalContext = { ...options.context };
        }
    }
    getHeaders(customVendor?: string): Record<string, string> {
        throw new Error("Method not implemented.");
    }
    event(name: string, attributes?: Record<string, unknown>): void {
        this.consola.info(name, attributes)
    }
    setAttribute(_key: string, _value: string | number | boolean): void {
        // A console-only logger emits no span record for an attribute to land on.
    }
    identify(_user: string | { id: string, [key: string]: unknown } | null): void {
        // A console-only logger carries no correlation keys: nothing downstream
        // would ever read them.
    }
    setSession(_session: { id: string, sampled: boolean } | undefined): void {
        // No-op for the same reason as identify().
    }
    setRoute(_route: string | undefined): void {
        // No-op for the same reason as identify().
    }
    getSpanContext(): TraceContext {
        // A console-only logger participates in no trace, so it has no span to
        // report. Callers treat a thrown/absent context as "no exemplar".
        throw new Error("Method not implemented.");
    }
    addContext(context: Object, options?: AddContextOptions): void {
        throw new Error("Method not implemented.");
    }
    setContext(context: Object): void {
        throw new Error("Method not implemented.");
    }
    clearContext(): void {
        throw new Error("Method not implemented.");
    }
    child(options: FroggerOptions): IFroggerLogger {
        throw new Error("Method not implemented.");
    }
    reactiveChild(options: FroggerOptions): IFroggerLogger {
        throw new Error("Method not implemented.");
    }
    span<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
        throw new Error("Method not implemented.");
    }
    startSpan(name: string, options?: FroggerOptions): IFroggerLogger {
        throw new Error("Method not implemented.");
    }
    silent(message: string, context?: Object): void {
        throw new Error("Method not implemented.");
    }
    verbose(message: string, context?: Object): void {
        throw new Error("Method not implemented.");
    }
    logLevel(level: LogType, message: string, context?: Object): void {
        throw new Error("Method not implemented.");
    }
    reset(): void {
        throw new Error("Method not implemented.");
    }

    private async handleLog(logObj: LogObject): Promise<void> {
        try {
            const loggerObject = this.createLoggerObject(logObj);

            await this.emitToReporters(loggerObject);
        } catch (error) {
            froggerInternal.error('Error in log handling pipeline:', error);
        }
    }

    private createLoggerObject(logObj: LogObject): LoggerObject {
        return {
            id: uuidv7(),
            time: logObj.date.getTime(),
            lvl: levelOf(logObj.type),
            sev: severityOf(logObj.type),
            msg: logObj.args?.[0],
            //@ts-expect-error
            trace: undefined,
            ctx: {
                type: logObj.type,
                ...this.globalContext,
                ...logObj.args?.slice(1)[0],
            }
        };
    }

    private async emitToReporters(loggerObject: LoggerObject): Promise<void> {
        if (this.customReporters.length === 0) return;

        const reporterPromises = this.customReporters.map(async (reporter) => {
            try {
                await reporter.log(loggerObject);
            } catch (error) {
                froggerInternal.error('Error in custom reporter:', error);
            }
        });

        await Promise.all(reporterPromises);
    }

    public addReporter(reporter: IFroggerReporter): void {
        this.customReporters.push(reporter);
    }

    public removeReporter(reporter: IFroggerReporter): void {
        const index = this.customReporters.indexOf(reporter);
        if (index > -1) {
            this.customReporters.splice(index, 1);
        }
    }

    public clearReporters(): void {
        this.customReporters = [];
    }

    public getReporters(): readonly IFroggerReporter[] {
        return [...this.customReporters];
    }


    public fatal(message: string, context?: Object): void {
        this.consola.fatal(message, context);
    }

    public error(message: string, context?: Object): void {
        this.consola.error(message, context);
    }

    public warn(message: string, context?: Object): void {
        this.consola.warn(message, context);
    }

    public log(message: string, context?: Object): void {
        this.consola.log(message, context);
    }

    public info(message: string, context?: Object): void {
        this.consola.info(message, context);
    }

    public success(message: string, context?: Object): void {
        this.consola.success(message, context);
    }

    public fail(message: string, context?: Object): void {
        this.consola.fail(message, context);
    }

    public ready(message: string, context?: Object): void {
        this.consola.ready(message, context);
    }

    public start(message: string, context?: Object): void {
        this.consola.start(message, context);
    }

    public debug(message: string, context?: Object): void {
        this.consola.debug(message, context);
    }

    public trace(message: string, context?: Object): void {
        this.consola.trace(message, context);
    }



    public setGlobalContext(context: LogContext): void {
        this.globalContext = { ...context };
    }

    public addToGlobalContext(context: LogContext): void {
        this.globalContext = { ...this.globalContext, ...context };
    }

    public getGlobalContext(): LogContext {
        return { ...this.globalContext };
    }

    public setLevel(level: number): void {
        this.level = level;
        this.consola.level = level;
    }

    public getLevel(): number {
        return this.level;
    }
}