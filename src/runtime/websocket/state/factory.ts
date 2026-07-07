//@ts-ignore
import { useStorage } from '#imports';
import { WebSocketStateKVLayer } from './index';
import type { StorageAdapter } from './index';
import { froggerInternal } from '../../shared/utils/internal-log';

let cachedLayer: WebSocketStateKVLayer | null = null;

export function createWebSocketStateKVLayer(storageKey?: string): WebSocketStateKVLayer | null {
    if (cachedLayer) {
        return cachedLayer;
    }
    
    try {
        const storage: StorageAdapter = useStorage();
        
        if (!storage) {
            froggerInternal.warn('WebSocketStateKVLayer: Storage not available yet');
            return null;
        }
        
        cachedLayer = new WebSocketStateKVLayer(storage, storageKey);
        return cachedLayer;
    } catch (error) {
        froggerInternal.error('WebSocketStateKVLayer: Error creating storage layer:', error);
        return null;
    }
}