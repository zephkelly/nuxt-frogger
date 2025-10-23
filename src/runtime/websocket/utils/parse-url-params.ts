import type { SubscriptionFilter, LogWebSocketParams } from "../types";

/**
 * Parses URL search parameters to extract channel and filter information
 * for WebSocket log subscriptions.
 * 
 * Supports two modes:
 * 1. JSON filters parameter: `?channel=main&filters={"level":[0,1],"type":["error"]}`
 * 2. Individual parameters: `?channel=main&level=0,1&type=error&tags=api&sources=server`
 * 
 * @param url - The URL object containing search parameters
 * @returns Parsed channel and filters
 * 
 * @example
 * ```ts
 * // Using JSON filters
 * const url = new URL('ws://localhost?channel=main&filters={"level":[0,1]}')
 * parseUrlParams(url) // { channel: 'main', filters: { level: [0, 1] } }
 * 
 * // Using individual parameters
 * const url = new URL('ws://localhost?channel=main&level=0,1&type=error,warn')
 * parseUrlParams(url) // { channel: 'main', filters: { level: ['0', '1'], type: ['error', 'warn'] } }
 * ```
 */
export function parseUrlParams(url: URL): LogWebSocketParams {
    const channel = url.searchParams.get('channel');
    const filtersParam = url.searchParams.get('filters');

    let filters: SubscriptionFilter | undefined;

    // Try to parse JSON filters first
    if (filtersParam) {
        try {
            filters = JSON.parse(filtersParam);
        }
        catch {
            console.warn('[Frogger] Invalid filters JSON, ignoring');
        }
    }

    // If no JSON filters, parse individual parameters
    if (!filters) {
        const level = url.searchParams.get('level');
        const type = url.searchParams.get('type');
        const tags = url.searchParams.get('tags');
        const sources = url.searchParams.get('sources');

        if (level || type || tags || sources) {
            filters = {};

            // Parse level parameter (can be comma-separated)
            if (level) {
                if (level.includes(',')) {
                    filters.level = level.split(',').map(l => l.trim());
                }
                else {
                    filters.level = level;
                }
            }

            // Parse type parameter (can be comma-separated)
            if (type) {
                if (type.includes(',')) {
                    filters.type = type.split(',').map(t => t.trim()) as any;
                }
                else {
                    filters.type = type as any;
                }
            }

            // Parse tags (comma-separated)
            if (tags) {
                filters.tags = tags.split(',').map(t => t.trim());
            }

            // Parse sources (comma-separated)
            if (sources) {
                filters.source = sources.split(',').map(s => s.trim());
            }
        }
    }

    return { channel: channel || undefined, filters };
}
