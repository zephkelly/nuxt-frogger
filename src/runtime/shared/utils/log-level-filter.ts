import { LOG_LEVELS } from "../types/log";




export class LogLevelFilter {
    static getLevelsUpTo(maxLevel: number): string[] {
        const levels: string[] = [];
        
        for (let level = 0; level <= maxLevel; level++) {
            if (LOG_LEVELS[level as keyof typeof LOG_LEVELS]) {
                levels.push(...LOG_LEVELS[level as keyof typeof LOG_LEVELS]);
            }
        }
        
        return levels;
    }

    static getExactLevel(level: number): string[] {
        const levels = LOG_LEVELS[level as keyof typeof LOG_LEVELS];
        return levels ? [...levels] : [];
    }

    static normalizeLevelFilter(levelFilter: string[] | number | undefined): string[] | undefined {
        if (levelFilter === undefined) {
            return undefined;
        }

        if (typeof levelFilter === 'number') {
            return this.getLevelsUpTo(levelFilter);
        }

        return levelFilter;
    }

    static passesLevelFilter(logLevel: string, levelFilter: string[] | number | undefined): boolean {
        if (!levelFilter) {
            return true;
        }

        const normalizedLevels = this.normalizeLevelFilter(levelFilter);
        if (!normalizedLevels) {
            return true;
        }

        return normalizedLevels.includes(logLevel);
    }

    static describeLevelFilter(levelFilter: string[] | number | undefined): string {
        if (!levelFilter) {
            return 'All levels';
        }

        if (typeof levelFilter === 'number') {
            const levels = this.getLevelsUpTo(levelFilter);
            return `Level ${levelFilter} and below (${levels.join(', ')})`;
        }

        return `Specific levels (${levelFilter.join(', ')})`;
    }
}