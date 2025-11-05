//@ts-ignore
import { useStorage } from '#imports';
import { WebSocketStateKVLayer } from './index';
import type { StorageAdapter } from './index';

let cachedLayer: WebSocketStateKVLayer | null = null;

export function createWebSocketStateKVLayer(storageKey?: string): WebSocketStateKVLayer | null {
    if (cachedLayer) {
        return cachedLayer;
    }
    
    try {
        const storage: StorageAdapter = useStorage();
        
        if (!storage) {
            console.warn('WebSocketStateKVLayer: Storage not available yet');
            return null;
        }
        
        cachedLayer = new WebSocketStateKVLayer(storage, storageKey);
        return cachedLayer;
    } catch (error) {
        console.error('WebSocketStateKVLayer: Error creating storage layer:', error);
        return null;
    }
}