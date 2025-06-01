import type { LogObject } from 'consola';
// import type { IFroggerReporter } from '../../types/frogger-reporter';



export class ConsoleReporter /*implements IFroggerReporter*/ {
    private isServer: boolean;
    
    constructor() {
        this.isServer = typeof window === 'undefined';
    }
    
    log(logObj: LogObject): void {
        const message = logObj.args?.[0] || '';
        const context = logObj.args?.slice(1);
        const timestamp = logObj.date.toISOString();

        if (this.isServer) {
            this.logToNodeConsole(logObj.type, message, context, timestamp);
        }
        else {
            this.logToBrowserConsole(logObj.type, message, context, timestamp);
        }
    }


    private hasContext(context: any[]): boolean {
        return context && context.length > 0 && context[0] !== undefined;
    }
    
    private logToNodeConsole(type: string, message: string, context: any[], timestamp: string): void {
        const colors = {
            reset: '\x1b[0m',
            bright: '\x1b[1m',
            red: '\x1b[31m',
            green: '\x1b[32m',
            yellow: '\x1b[33m',
            blue: '\x1b[34m',
            magenta: '\x1b[35m',
            cyan: '\x1b[36m',
            white: '\x1b[37m',
            gray: '\x1b[90m'
        };
        
        const typeColors = {
            error: colors.red,
            warn: colors.yellow,
            info: colors.blue,
            debug: colors.gray,
            trace: colors.magenta,
            success: colors.green,
            fatal: colors.red + colors.bright,
            log: colors.white
        };
        
        const typeIcons = {
            error: '✖',
            warn: '⚠',
            info: 'ℹ',
            debug: '🐛',
            trace: '📍',
            success: '✔',
            fatal: '💥',
            log: '📝'
        };
        
        const color = typeColors[type as keyof typeof typeColors] || colors.white;
        const icon = typeIcons[type as keyof typeof typeIcons] || '•';
        const typeLabel = type.toUpperCase().padEnd(5);
        
        const formattedMessage = `${colors.gray}[${timestamp}]${colors.reset} ${color}${icon}  ${typeLabel}${colors.reset} ${message}`;
        
        switch (type) {
            case 'error':
            case 'fatal':
                this.hasContext(context) ? console.log(formattedMessage, ...context) : console.log(formattedMessage);
                break;
            case 'warn':
                this.hasContext(context) ? console.log(formattedMessage, ...context) : console.log(formattedMessage);
                break;
            case 'debug':
            case 'trace':
                this.hasContext(context) ? console.log(formattedMessage, ...context) : console.log(formattedMessage);
                break;
            default:
                this.hasContext(context)
                    ? console.log(`${colors.gray}[${timestamp}]${colors.reset}  ${color}${icon} ${typeLabel}${colors.reset} ${message}`, ...context) 
                    : console.log(`${colors.gray}[${timestamp}]${colors.reset}  ${color}${icon} ${typeLabel}${colors.reset} ${message}`);
        }
    }

    private logToBrowserConsole(type: string, message: string, context: any[], timestamp: string): void {
        const typeStyles = {
            error: 'color: #ff6b6b; font-weight: bold;',
            warn: 'color: #feca57; font-weight: bold;',
            info: 'color: #0972c6; font-weight: bold;',
            debug: 'color: #a4b0be; font-style: italic;',
            trace: 'color: #8b5cf6; font-style: italic;',
            success: 'color: #2ed573; font-weight: bold;',
            fatal: 'color:rgb(243, 74, 74); font-weight: bold; background: rgb(59, 13, 13);',
            log: 'color:rgb(125, 133, 148);'
        };
        
        const typeIcons = {
            error: '✖️',
            warn: '⚠️',
            info: 'ℹ️',
            debug: '🐛',
            trace: '📍',
            success: '✅',
            fatal: '💥',
            log: '📝'
        };
        
        const style = typeStyles[type as keyof typeof typeStyles] || typeStyles.log;
        const icon = typeIcons[type as keyof typeof typeIcons] || '•';
        const typeLabel = type.toUpperCase();
        
        const messageTypeStyling = `${icon} %c[${typeLabel}]`.padEnd(12);
        const timestampStyle = 'color: #a4b0be; font-size: 0.8em;';

        
        switch (type) {
            case 'error':
            case 'fatal':
                this.hasContext(context) ? console.log(messageTypeStyling, style, message, ...context) : console.log(messageTypeStyling, style, message);
                console.log(`%c${timestamp}`, timestampStyle);
                break;
            case 'warn':
                this.hasContext(context) ? console.log(messageTypeStyling, style, message, ...context) : console.log(messageTypeStyling, style, message);
                console.log(`%c${timestamp}`, timestampStyle);
                break;
            case 'debug':
            case 'trace':
                this.hasContext(context) ? console.log(messageTypeStyling, style, message, ...context) : console.log(messageTypeStyling, style, message);
                console.log(`%c${timestamp}`, timestampStyle);
                break;
            default:
                this.hasContext(context) ? console.log(messageTypeStyling, style, message, ...context) : console.log(messageTypeStyling, style, message);
                console.log(`%c${timestamp}`, timestampStyle);
        }
    }
}