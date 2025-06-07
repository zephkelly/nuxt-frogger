import type { LogObject } from 'consola';
import type { IFroggerReporter } from './types';
import type { LoggerObject } from '../../shared/types/log';



export class ConsoleReporter implements IFroggerReporter {
    private isServer: boolean;
    
    constructor() {
        this.isServer = typeof window === 'undefined';
    }
    
    log(logObj: LoggerObject): void {
        const message = logObj.msg
        const timestamp = logObj.time

        if (this.isServer) {
            this.logToNodeConsole(logObj.type, message, timestamp);
        }
        else {
            this.logToBrowserConsole(logObj.type, message, timestamp);
        }
    }

    private logToNodeConsole(type: string, message: string | undefined, timestamp: number): void {
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
            gray: '\x1b[90m',
            bgRed: '\x1b[41m',
            bgBrightRed: '\x1b[101m'
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

        const timestampIso = new Date(timestamp).toISOString();

        const formattedMessage = `${colors.gray}[${timestampIso}]${colors.reset} ${color}${icon}  ${typeLabel}${colors.reset} ${message}`;

        switch (type) {
            case 'error':
            case 'fatal':
                console.log(formattedMessage);
                break;
            case 'warn':
                console.log(formattedMessage);
                break;
            case 'debug':
            case 'trace':
                console.log(formattedMessage);
                break;
            default:
                console.log(`${colors.gray}[${timestampIso}]${colors.reset}  ${color}${icon} ${typeLabel}${colors.reset} ${message}`);
        }
    }

    private logToBrowserConsole(type: string, message: string | undefined, timestamp: number): void {
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

        const timestampIso = new Date(timestamp).toISOString();

        switch (type) {
            case 'error':
            case 'fatal':
                console.error(messageTypeStyling, style, message);
                console.error(`%c${timestampIso}`, timestampStyle);
                break;
            case 'warn':
                console.log(messageTypeStyling, style, message);
                console.log(`%c${timestampIso}`, timestampStyle);
                break;
            case 'debug':
            case 'trace':
                console.log(messageTypeStyling, style, message);
                console.log(`%c${timestampIso}`, timestampStyle);
                break;
            default:
                console.log(messageTypeStyling, style, message);
                console.log(`%c${timestampIso}`, timestampStyle);
        }
    }
}