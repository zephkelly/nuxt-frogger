import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { WebSocketStateKVLayer } from '../../src/runtime/websocket/state/index'
import type { StorageAdapter } from '../../src/runtime/websocket/state/index'
import type { PersistedChannel, PersistedSubscription } from '../../src/runtime/websocket/types'

describe('WebSocketStateKVLayer', () => {
    let kvLayer: WebSocketStateKVLayer
    let mockStorage: StorageAdapter
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        mockStorage = {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            getKeys: vi.fn()
        }
        kvLayer = new WebSocketStateKVLayer(mockStorage, 'test-storage')
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
    })

    afterEach(() => {
        consoleErrorSpy.mockRestore()
    })

    describe('Channel Management', () => {
        it('should get a channel', async () => {
            const mockChannel: PersistedChannel = {
                channel_uuid: 'channel-1',
                last_activity: Date.now(),
                created_at: Date.now(),
                subscribers: new Map()
            }

            vi.mocked(mockStorage.getItem).mockResolvedValue(mockChannel)

            const result = await kvLayer.getChannel('channel-1')

            expect(mockStorage.getItem).toHaveBeenCalledWith('test-storage:channels:channel-1')
            expect(result).toEqual(mockChannel)
        })

        it('should set a channel', async () => {
            const mockChannel: PersistedChannel = {
                channel_uuid: 'channel-1',
                last_activity: Date.now(),
                created_at: Date.now(),
                subscribers: new Map()
            }

            await kvLayer.setChannel('channel-1', mockChannel)

            expect(mockStorage.setItem).toHaveBeenCalledWith(
                'test-storage:channels:channel-1',
                mockChannel
            )
        })

        it('should set a channel with TTL', async () => {
            const mockChannel: PersistedChannel = {
                channel_uuid: 'channel-1',
                last_activity: Date.now(),
                created_at: Date.now(),
                subscribers: new Map()
            }
            const ttl = 3600

            await kvLayer.setChannel('channel-1', mockChannel, ttl)

            expect(mockStorage.setItem).toHaveBeenCalled()
            const call = vi.mocked(mockStorage.setItem).mock.calls[0]
            expect(call[0]).toBe('test-storage:channels:channel-1')
            expect(call[1]).toHaveProperty('data', mockChannel)
            expect(call[1]).toHaveProperty('expiresAt')
        })

        it('should delete a channel', async () => {
            await kvLayer.deleteChannel('channel-1')

            expect(mockStorage.removeItem).toHaveBeenCalledWith('test-storage:channels:channel-1')
            expect(mockStorage.removeItem).toHaveBeenCalledWith('test-storage:channel-peers:channel-1')
        })

        it('should get all channels', async () => {
            const mockChannels: PersistedChannel[] = [
                {
                    channel_uuid: 'channel-1', last_activity: Date.now(), created_at: Date.now(),
                    subscribers: new Map()
                },
                {
                    channel_uuid: 'channel-2', last_activity: Date.now(), created_at: Date.now(),
                    subscribers: new Map()
                }
            ]

            vi.mocked(mockStorage.getKeys).mockResolvedValue([
                'test-storage:channels:channel-1',
                'test-storage:channels:channel-2'
            ])

            vi.mocked(mockStorage.getItem)
                .mockResolvedValueOnce(mockChannels[0])
                .mockResolvedValueOnce(mockChannels[1])

            const result = await kvLayer.getAllChannels()

            expect(result).toEqual(mockChannels)
        })
    })

    describe('Subscription Management', () => {
        it('should get a subscription', async () => {
            const mockSubscription: PersistedSubscription = {
                peer_id: 'peer-1',
                channels: ['channel-1'],
                subscribed_at: Date.now(),
                last_activity: Date.now()
            }

            vi.mocked(mockStorage.getItem).mockResolvedValue(mockSubscription)

            const result = await kvLayer.getSubscription('peer-1')

            expect(mockStorage.getItem).toHaveBeenCalledWith('test-storage:subscriptions:peer-1')
            expect(result).toEqual(mockSubscription)
        })

        it('should set a subscription', async () => {
            const mockSubscription: PersistedSubscription = {
                peer_id: 'peer-1',
                channels: ['channel-1'],
                subscribed_at: Date.now(),
                last_activity: Date.now()
            }

            await kvLayer.setSubscription('peer-1', mockSubscription)

            expect(mockStorage.setItem).toHaveBeenCalledWith(
                'test-storage:subscriptions:peer-1',
                mockSubscription
            )
        })

        it('should delete a subscription', async () => {
            await kvLayer.deleteSubscription('peer-1')

            expect(mockStorage.removeItem).toHaveBeenCalledWith('test-storage:subscriptions:peer-1')
        })
    })

    describe('Channel Peers Management', () => {
        it('should add a peer to channel', async () => {
            vi.mocked(mockStorage.getItem).mockResolvedValue([])

            await kvLayer.addPeerToChannel('channel-1', 'peer-1')

            expect(mockStorage.setItem).toHaveBeenCalledWith(
                'test-storage:channel-peers:channel-1',
                ['peer-1']
            )
        })

        it('should not add duplicate peer to channel', async () => {
            vi.mocked(mockStorage.getItem).mockResolvedValue(['peer-1'])

            await kvLayer.addPeerToChannel('channel-1', 'peer-1')

            expect(mockStorage.setItem).not.toHaveBeenCalled()
        })

        it('should remove peer from channel', async () => {
            vi.mocked(mockStorage.getItem).mockResolvedValue(['peer-1', 'peer-2'])

            await kvLayer.removePeerFromChannel('channel-1', 'peer-1')

            expect(mockStorage.setItem).toHaveBeenCalledWith(
                'test-storage:channel-peers:channel-1',
                ['peer-2']
            )
        })

        it('should delete channel peers key when last peer removed', async () => {
            vi.mocked(mockStorage.getItem).mockResolvedValue(['peer-1'])

            await kvLayer.removePeerFromChannel('channel-1', 'peer-1')

            expect(mockStorage.removeItem).toHaveBeenCalledWith('test-storage:channel-peers:channel-1')
        })

        it('should get channel peers', async () => {
            vi.mocked(mockStorage.getItem).mockResolvedValue(['peer-1', 'peer-2'])

            const result = await kvLayer.getChannelPeers('channel-1')

            expect(result).toEqual(['peer-1', 'peer-2'])
        })
    })

    describe('TTL and Expiration', () => {
        it('should return null for expired items', async () => {
            const expiredItem = {
                data: { channel_uuid: 'channel-1' },
                expiresAt: Date.now() - 1000
            }

            vi.mocked(mockStorage.getItem).mockResolvedValue(expiredItem)

            const result = await kvLayer.getChannel('channel-1')

            expect(result).toBeNull()
            expect(mockStorage.removeItem).toHaveBeenCalledWith('test-storage:channels:channel-1')
        })

        it('should return data for non-expired items', async () => {
            const validItem = {
                data: { channel_uuid: 'channel-1', last_activity: Date.now() },
                expiresAt: Date.now() + 10000
            }

            vi.mocked(mockStorage.getItem).mockResolvedValue(validItem)

            const result = await kvLayer.getChannel('channel-1')

            expect(result).toEqual(validItem.data)
        })
    })

    describe('Activity Updates', () => {
        it('should update channel activity', async () => {
            const mockChannel: PersistedChannel = {
                channel_uuid: 'channel-1',
                last_activity: Date.now() - 10000,
                created_at: Date.now(),
                subscribers: new Map()
            }

            vi.mocked(mockStorage.getItem).mockResolvedValue(mockChannel)

            await kvLayer.updateChannelActivity('channel-1')

            expect(mockStorage.setItem).toHaveBeenCalled()
            const call = vi.mocked(mockStorage.setItem).mock.calls[0]
            expect(call[1].last_activity).toBeGreaterThan(mockChannel.last_activity)
        })

        it('should not update activity if channel does not exist', async () => {
            vi.mocked(mockStorage.getItem).mockResolvedValue(null)

            await kvLayer.updateChannelActivity('nonexistent')

            expect(mockStorage.setItem).not.toHaveBeenCalled()
        })

        it('should handle errors when updating channel activity', async () => {
            vi.mocked(mockStorage.getItem).mockRejectedValue(new Error('Storage error'))

            await kvLayer.updateChannelActivity('channel-1')

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to get WebSocket storage key'),
                expect.any(Error)
            )
        })

        it('should update subscription activity', async () => {
            const mockSubscription: PersistedSubscription = {
                peer_id: 'peer-1',
                channels: ['channel-1'],
                subscribed_at: Date.now(),
                last_activity: Date.now() - 10000
            }

            vi.mocked(mockStorage.getItem).mockResolvedValue(mockSubscription)

            await kvLayer.updateSubscriptionActivity('peer-1')

            expect(mockStorage.setItem).toHaveBeenCalled()
            const call = vi.mocked(mockStorage.setItem).mock.calls[0]
            expect(call[1].last_activity).toBeGreaterThan(mockSubscription.last_activity)
        })

        it('should not update activity if subscription does not exist', async () => {
            vi.mocked(mockStorage.getItem).mockResolvedValue(null)

            await kvLayer.updateSubscriptionActivity('nonexistent')

            expect(mockStorage.setItem).not.toHaveBeenCalled()
        })

        it('should handle errors when updating subscription activity', async () => {
            vi.mocked(mockStorage.getItem).mockRejectedValue(new Error('Storage error'))

            await kvLayer.updateSubscriptionActivity('peer-1')

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to get WebSocket storage key'),
                expect.any(Error)
            )
        })
    })

    describe('Subscription Management - Additional', () => {
        it('should get all subscriptions', async () => {
            const mockSubscriptions: PersistedSubscription[] = [
                {
                    peer_id: 'peer-1',
                    channels: ['channel-1'],
                    subscribed_at: Date.now(),
                    last_activity: Date.now()
                },
                {
                    peer_id: 'peer-2',
                    channels: ['channel-2'],
                    subscribed_at: Date.now(),
                    last_activity: Date.now()
                }
            ]

            vi.mocked(mockStorage.getKeys).mockResolvedValue([
                'test-storage:subscriptions:peer-1',
                'test-storage:subscriptions:peer-2'
            ])

            vi.mocked(mockStorage.getItem)
                .mockResolvedValueOnce(mockSubscriptions[0])
                .mockResolvedValueOnce(mockSubscriptions[1])

            const result = await kvLayer.getAllSubscriptions()

            expect(result).toEqual(mockSubscriptions)
        })

        it('should filter out null subscriptions when getting all', async () => {
            vi.mocked(mockStorage.getKeys).mockResolvedValue([
                'test-storage:subscriptions:peer-1',
                'test-storage:subscriptions:peer-2'
            ])

            vi.mocked(mockStorage.getItem)
                .mockResolvedValueOnce({ peer_id: 'peer-1', channels: ['channel-1'], subscribed_at: Date.now(), last_activity: Date.now() })
                .mockResolvedValueOnce(null)

            const result = await kvLayer.getAllSubscriptions()

            expect(result).toHaveLength(1)
        })

        it('should handle errors when getting all subscriptions', async () => {
            vi.mocked(mockStorage.getKeys).mockRejectedValue(new Error('Storage error'))

            const result = await kvLayer.getAllSubscriptions()

            expect(result).toEqual([])
            expect(consoleErrorSpy).toHaveBeenCalled()
        })
    })

    describe('Error Handling', () => {
        it('should handle errors when getting keys', async () => {
            vi.mocked(mockStorage.getKeys).mockRejectedValue(new Error('Storage error'))

            const result = await kvLayer.getAllChannels()

            expect(result).toEqual([])
            expect(consoleErrorSpy).toHaveBeenCalled()
        })

        it('should handle errors when adding peer to channel', async () => {
            vi.mocked(mockStorage.getItem).mockRejectedValue(new Error('Storage error'))

            await kvLayer.addPeerToChannel('channel-1', 'peer-1')

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to get WebSocket storage key'),
                expect.any(Error)
            )
        })

        it('should handle errors when removing peer from channel', async () => {
            vi.mocked(mockStorage.getItem).mockRejectedValue(new Error('Storage error'))

            await kvLayer.removePeerFromChannel('channel-1', 'peer-1')

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to get WebSocket storage key'),
                expect.any(Error)
            )
        })

        it('should handle errors when getting channel peers', async () => {
            vi.mocked(mockStorage.getItem).mockRejectedValue(new Error('Storage error'))

            const result = await kvLayer.getChannelPeers('channel-1')

            expect(result).toEqual([])
            expect(consoleErrorSpy).toHaveBeenCalled()
        })
    })

    describe('Cleanup Operations', () => {
        it('should cleanup expired items', async () => {
            const expiredItem = {
                data: { channel_uuid: 'channel-1' },
                expiresAt: Date.now() - 1000
            }
            const validItem = {
                data: { channel_uuid: 'channel-2' },
                expiresAt: Date.now() + 10000
            }

            vi.mocked(mockStorage.getKeys)
                .mockResolvedValueOnce(['test-storage:channels:channel-1', 'test-storage:channels:channel-2'])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])

            vi.mocked(mockStorage.getItem)
                .mockResolvedValueOnce(expiredItem)
                .mockResolvedValueOnce(validItem)
                .mockResolvedValueOnce([])

            await kvLayer.cleanup()

            expect(mockStorage.removeItem).toHaveBeenCalledWith('test-storage:channels:channel-1')
            expect(mockStorage.removeItem).not.toHaveBeenCalledWith('test-storage:channels:channel-2')
        })

        it('should cleanup empty channels older than 24 hours', async () => {
            const oldChannel: PersistedChannel = {
                channel_uuid: 'old-channel',
                last_activity: Date.now() - (25 * 60 * 60 * 1000),
                created_at: Date.now(),
                subscribers: new Map()
            }

            vi.mocked(mockStorage.getKeys)
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce(['test-storage:channels:old-channel'])

            vi.mocked(mockStorage.getItem)
                .mockResolvedValueOnce(oldChannel)
                .mockResolvedValueOnce([])

            await kvLayer.cleanup()

            expect(mockStorage.removeItem).toHaveBeenCalledWith('test-storage:channels:old-channel')
        })

        it('should not cleanup channels with peers', async () => {
            const channelWithPeers: PersistedChannel = {
                channel_uuid: 'active-channel',
                last_activity: Date.now() - (25 * 60 * 60 * 1000),
                created_at: Date.now(),
                subscribers: new Map()
            }

            vi.mocked(mockStorage.getKeys)
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce(['test-storage:channels:active-channel'])

            vi.mocked(mockStorage.getItem)
                .mockResolvedValueOnce(channelWithPeers)
                .mockResolvedValueOnce(['peer-1', 'peer-2'])

            await kvLayer.cleanup()

            expect(mockStorage.removeItem).not.toHaveBeenCalledWith('test-storage:channels:active-channel')
        })

        it('should not cleanup recent empty channels', async () => {
            const recentChannel: PersistedChannel = {
                channel_uuid: 'recent-channel',
                last_activity: Date.now() - (1 * 60 * 60 * 1000),
                created_at: Date.now(),
                subscribers: new Map()
            }

            vi.mocked(mockStorage.getKeys)
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce(['test-storage:channels:recent-channel'])

            vi.mocked(mockStorage.getItem)
                .mockResolvedValueOnce(recentChannel)
                .mockResolvedValueOnce([])

            await kvLayer.cleanup()

            expect(mockStorage.removeItem).not.toHaveBeenCalledWith('test-storage:channels:recent-channel')
        })

        it('should handle errors during cleanup', async () => {
            vi.mocked(mockStorage.getKeys).mockRejectedValue(new Error('Storage error'))

            await kvLayer.cleanup()

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to get keys with prefix'),
                expect.any(Error)
            )
        })

        it('should handle errors during empty channel cleanup', async () => {
            vi.mocked(mockStorage.getKeys)
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockRejectedValueOnce(new Error('Storage error'))

            await kvLayer.cleanup()

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Failed to get keys with prefix'),
                expect.any(Error)
            )
        })

        it('should handle non-expired items during cleanup', async () => {
            const item = { data: 'value' }

            vi.mocked(mockStorage.getKeys)
                .mockResolvedValueOnce(['test-storage:channels:channel-1'])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])

            vi.mocked(mockStorage.getItem).mockResolvedValueOnce(item)

            await kvLayer.cleanup()

            expect(mockStorage.removeItem).not.toHaveBeenCalled()
        })

        it('should handle invalid items during expiration check', async () => {
            vi.mocked(mockStorage.getKeys)
                .mockResolvedValueOnce(['test-storage:channels:channel-1'])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])

            vi.mocked(mockStorage.getItem).mockResolvedValueOnce(null)

            await kvLayer.cleanup()
        })
    })

    describe('Storage Statistics', () => {
        it('should get storage stats', async () => {
            const channels: PersistedChannel[] = [
                {
                    channel_uuid: 'channel-1',
                    last_activity: Date.now(),
                    created_at: Date.now(),
                    subscribers: new Map()
                },
                {
                    channel_uuid: 'channel-2',
                    last_activity: Date.now(),
                    created_at: Date.now(),
                    subscribers: new Map()
                }
            ]

            const subscriptions: PersistedSubscription[] = [
                {
                    peer_id: 'peer-1',
                    channels: ['channel-1'],
                    subscribed_at: Date.now(),
                    last_activity: Date.now()
                }
            ]

            vi.mocked(mockStorage.getKeys)
                .mockResolvedValueOnce(['test-storage:channels:channel-1', 'test-storage:channels:channel-2'])
                .mockResolvedValueOnce(['test-storage:subscriptions:peer-1'])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce(['test-storage:channel-peers:channel-1'])

            vi.mocked(mockStorage.getItem)
                .mockResolvedValueOnce(channels[0])
                .mockResolvedValueOnce(channels[1])
                .mockResolvedValueOnce(subscriptions[0])
                .mockResolvedValueOnce(['peer-1'])
                .mockResolvedValueOnce([])

            const stats = await kvLayer.getStorageStats()

            expect(stats.totalChannels).toBe(2)
            expect(stats.totalSubscriptions).toBe(1)
            expect(stats.channelsWithPeers).toBe(1)
            expect(stats.orphanedPeerMappings).toBe(0)
        })

        it('should detect orphaned peer mappings', async () => {
            const channels: PersistedChannel[] = [
                {
                    channel_uuid: 'channel-1',
                    last_activity: Date.now(),
                    created_at: Date.now(),
                    subscribers: new Map()
                }
            ]

            vi.mocked(mockStorage.getKeys)
                .mockResolvedValueOnce(['test-storage:channels:channel-1'])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([
                    'test-storage:channel-peers:channel-1',
                    'test-storage:channel-peers:orphaned-channel'
                ])

            vi.mocked(mockStorage.getItem)
                .mockResolvedValueOnce(channels[0])
                .mockResolvedValueOnce([])

            const stats = await kvLayer.getStorageStats()

            expect(stats.orphanedPeerMappings).toBe(1)
        })

        it('should handle errors when getting storage stats', async () => {
            vi.mocked(mockStorage.getKeys).mockRejectedValue(new Error('Storage error'))

            const stats = await kvLayer.getStorageStats()

            expect(stats).toEqual({
                totalChannels: 0,
                totalSubscriptions: 0,
                channelsWithPeers: 0,
                orphanedPeerMappings: 0
            })
            expect(consoleErrorSpy).toHaveBeenCalled()
        })
    })
})