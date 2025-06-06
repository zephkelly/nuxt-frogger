export function formatSecondsDuration(seconds: number): string {
    if (seconds < 60) {
        return `${seconds} seconds`
    }
    else if (seconds < 3600) {
        const minutes = Math.round(seconds / 60)
        return `${minutes} minute${minutes !== 1 ? 's' : ''}`
    }
    else {
        const hours = Math.round(seconds / 3600 * 10) / 10
        return `${hours} hour${hours !== 1 ? 's' : ''}`
    }
}