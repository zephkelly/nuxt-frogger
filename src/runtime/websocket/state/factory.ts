//@ts-ignore
import { useStorage } from '#imports';
import { WebSocketStateKVLayer } from './index';
import type { StorageAdapter } from './index';

export function createWebSocketStateKVLayer(storageKey?: string): WebSocketStateKVLayer {
    const storage: StorageAdapter = useStorage();
    return new WebSocketStateKVLayer(storage, storageKey);
}