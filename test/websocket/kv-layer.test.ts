import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { WebSocketStateKVLayer } from './../../src/runtime/websocket/state/index' // Adjust path
import type { PersistedChannel, PersistedSubscription } from './../../src/runtime/websocket/types' // Adjust path

// Mock Nitro's useStorage
const mockStorage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    getKeys: vi.fn()
}

vi.mock('#imports', () => ({
    useStorage: () => mockStorage
}))

describe('WebSocketStateKVLayer', () => {
    let kvLayer: WebSocketStateKVLayer
    const storageKey = 'test-websocket-storage'

    beforeEach(() => {
        kvLayer = new WebSocketStateKVLayer(storageKey)
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.resetAllMocks()
    })

    describe('constructor', () => {
        it('should initialize with default storage key', () => {
            const defaultLayer = new WebSocketStateKVLayer()
            expect(defaultLayer.getStorageKey()).toBe('websocket-log-reporter')
        })

        it('should initialize with custom storage key', () => {
            expect(kvLayer.getStorageKey()).toBe(storageKey)
        })
    })

    describe('channel operations', () => {
        const channelId = 'test-channel-123'
        const mockChannel: PersistedChannel = {
            channel_uuid: channelId,
            subscribers: new Map(),
            created_at: Date.now(),
            last_activity: Date.now(),
            metadata: { test: 'data' }
        }

        describe('setChannel', () => {
            it('should store a channel without TTL', async () => {
                await kvLayer.setChannel(channelId, mockChannel)

                expect(mockStorage.setItem).toHaveBeenCalledWith(
                    `${storageKey}:channels:${channelId}`,
                    mockChannel
                )
            })

            it('should store a channel with TTL', async () => {
                const ttl = 3600 // 1 hour
                await kvLayer.setChannel(channelId, mockChannel, ttl)

                expect(mockStorage.setItem).toHaveBeenCalledWith(
                    `${storageKey}:channels:${channelId}`,
                    expect.objectContaining({
                        data: mockChannel,
                        expiresAt: expect.any(Number)
                    })
                )

                const call = mockStorage.setItem.mock.calls[0][1]
                expect(call.expiresAt).toBeGreaterThan(Date.now())
            })

            it('should handle storage errors gracefully', async () => {
                mockStorage.setItem.mockRejectedValueOnce(new Error('Storage failed'))

                await expect(kvLayer.setChannel(channelId, mockChannel)).rejects.toThrow('Storage failed')
            })
        })

        describe('getChannel', () => {
            it('should retrieve a channel', async () => {
                mockStorage.getItem.mockResolvedValueOnce(mockChannel)

                const result = await kvLayer.getChannel(channelId)

                expect(mockStorage.getItem).toHaveBeenCalledWith(
                    `${storageKey}:channels:${channelId}`
                )
                expect(result).toEqual(mockChannel)
            })

            it('should return null for non-existent channel', async () => {
                mockStorage.getItem.mockResolvedValueOnce(null)

                const result = await kvLayer.getChannel('non-existent')

                expect(result).toBeNull()
            })

            it('should handle expired channels with TTL', async () => {
                const expiredData = {
                    data: mockChannel,
                    expiresAt: Date.now() - 1000 // Expired 1 second ago
                }
                mockStorage.getItem.mockResolvedValueOnce(expiredData)

                const result = await kvLayer.getChannel(channelId)

                expect(result).toBeNull()
                expect(mockStorage.removeItem).toHaveBeenCalledWith(
                    `${storageKey}:channels:${channelId}`
                )
            })

            it('should return valid TTL data that has not expired', async () => {
                const validData = {
                    data: mockChannel,
                    expiresAt: Date.now() + 10000 // Expires in 10 seconds
                }
                mockStorage.getItem.mockResolvedValueOnce(validData)

                const result = await kvLayer.getChannel(channelId)

                expect(result).toEqual(mockChannel)
                expect(mockStorage.removeItem).not.toHaveBeenCalled()
            })

            it('should handle storage errors gracefully', async () => {
                mockStorage.getItem.mockRejectedValueOnce(new Error('Read failed'))

                const result = await kvLayer.getChannel(channelId)

                expect(result).toBeNull()
            })
        })

        describe('deleteChannel', () => {
            it('should delete channel and its peers mapping', async () => {
                await kvLayer.deleteChannel(channelId)

                expect(mockStorage.removeItem).toHaveBeenCalledTimes(2)
                expect(mockStorage.removeItem).toHaveBeenCalledWith(
                    `${storageKey}:channels:${channelId}`
                )
                expect(mockStorage.removeItem).toHaveBeenCalledWith(
                    `${storageKey}:channel-peers:${channelId}`
                )
            })

            it('should handle deletion errors gracefully', async () => {
                mockStorage.removeItem.mockRejectedValueOnce(new Error('Delete failed'))

                // Should not throw
                await kvLayer.deleteChannel(channelId)
            })
        })

        describe('getAllChannels', () => {
            it('should retrieve all channels', async () => {
                const channel1: PersistedChannel = { ...mockChannel, channel_uuid: 'channel-1' }
                const channel2: PersistedChannel = { ...mockChannel, channel_uuid: 'channel-2' }

                mockStorage.getKeys.mockResolvedValueOnce([
                    `${storageKey}:channels:channel-1`,
                    `${storageKey}:channels:channel-2`
                ])
                mockStorage.getItem
                    .mockResolvedValueOnce(channel1)
                    .mockResolvedValueOnce(channel2)

                const result = await kvLayer.getAllChannels()

                expect(result).toHaveLength(2)
                expect(result).toEqual([channel1, channel2])
            })

            it('should filter out null channels', async () => {
                mockStorage.getKeys.mockResolvedValueOnce([
                    `${storageKey}:channels:channel-1`,
                    `${storageKey}:channels:channel-2`
                ])
                mockStorage.getItem
                    .mockResolvedValueOnce(mockChannel)
                    .mockResolvedValueOnce(null)

                const result = await kvLayer.getAllChannels()

                expect(result).toHaveLength(1)
                expect(result[0]).toEqual(mockChannel)
            })

            it('should return empty array on error', async () => {
                mockStorage.getKeys.mockRejectedValueOnce(new Error('Keys failed'))

                const result = await kvLayer.getAllChannels()

                expect(result).toEqual([])
            })
        })
    })

    describe('subscription operations', () => {
        const peerId = 'peer-123'
        const mockSubscription: PersistedSubscription = {
            peer_id: peerId,
            channels: ['channel-1', 'channel-2'],
            filters: { level: ['2'], tags: ['test'] },
            subscribed_at: Date.now(),
            last_activity: Date.now()
        }

        describe('setSubscription', () => {
            it('should store a subscription', async () => {
                await kvLayer.setSubscription(peerId, mockSubscription)

                expect(mockStorage.setItem).toHaveBeenCalledWith(
                    `${storageKey}:subscriptions:${peerId}`,
                    mockSubscription
                )
            })

            it('should store a subscription with TTL', async () => {
                const ttl = 7200
                await kvLayer.setSubscription(peerId, mockSubscription, ttl)

                expect(mockStorage.setItem).toHaveBeenCalledWith(
                    `${storageKey}:subscriptions:${peerId}`,
                    expect.objectContaining({
                        data: mockSubscription,
                        expiresAt: expect.any(Number)
                    })
                )
            })
        })

        describe('getSubscription', () => {
            it('should retrieve a subscription', async () => {
                mockStorage.getItem.mockResolvedValueOnce(mockSubscription)

                const result = await kvLayer.getSubscription(peerId)

                expect(result).toEqual(mockSubscription)
            })

            it('should return null for non-existent subscription', async () => {
                mockStorage.getItem.mockResolvedValueOnce(null)

                const result = await kvLayer.getSubscription('non-existent')

                expect(result).toBeNull()
            })
        })

        describe('deleteSubscription', () => {
            it('should delete a subscription', async () => {
                await kvLayer.deleteSubscription(peerId)

                expect(mockStorage.removeItem).toHaveBeenCalledWith(
                    `${storageKey}:subscriptions:${peerId}`
                )
            })
        })

        describe('getAllSubscriptions', () => {
            it('should retrieve all subscriptions', async () => {
                const sub1 = { ...mockSubscription, peer_id: 'peer-1' }
                const sub2 = { ...mockSubscription, peer_id: 'peer-2' }

                mockStorage.getKeys.mockResolvedValueOnce([
                    `${storageKey}:subscriptions:peer-1`,
                    `${storageKey}:subscriptions:peer-2`
                ])
                mockStorage.getItem
                    .mockResolvedValueOnce(sub1)
                    .mockResolvedValueOnce(sub2)

                const result = await kvLayer.getAllSubscriptions()

                expect(result).toHaveLength(2)
                expect(result).toEqual([sub1, sub2])
            })

            it('should return empty array on error', async () => {
                mockStorage.getKeys.mockRejectedValueOnce(new Error('Failed'))

                const result = await kvLayer.getAllSubscriptions()

                expect(result).toEqual([])
            })
        })
    })

    describe('channel-peer mapping operations', () => {
        const channelId = 'channel-123'
        const peerId1 = 'peer-1'
        const peerId2 = 'peer-2'

        describe('addPeerToChannel', () => {
            it('should add a peer to an empty channel', async () => {
                mockStorage.getItem.mockResolvedValueOnce(null)

                await kvLayer.addPeerToChannel(channelId, peerId1)

                expect(mockStorage.setItem).toHaveBeenCalledWith(
                    `${storageKey}:channel-peers:${channelId}`,
                    [peerId1]
                )
            })

            it('should add a peer to existing channel peers', async () => {
                mockStorage.getItem.mockResolvedValueOnce([peerId1])

                await kvLayer.addPeerToChannel(channelId, peerId2)

                expect(mockStorage.setItem).toHaveBeenCalledWith(
                    `${storageKey}:channel-peers:${channelId}`,
                    [peerId1, peerId2]
                )
            })

            it('should not add duplicate peers', async () => {
                mockStorage.getItem.mockResolvedValueOnce([peerId1])

                await kvLayer.addPeerToChannel(channelId, peerId1)

                expect(mockStorage.setItem).not.toHaveBeenCalled()
            })

            it('should handle errors gracefully', async () => {
                mockStorage.getItem.mockRejectedValueOnce(new Error('Failed'))

                // Should not throw
                await kvLayer.addPeerToChannel(channelId, peerId1)
            })
        })

        describe('removePeerFromChannel', () => {
            it('should remove a peer from channel', async () => {
                mockStorage.getItem.mockResolvedValueOnce([peerId1, peerId2])

                await kvLayer.removePeerFromChannel(channelId, peerId1)

                expect(mockStorage.setItem).toHaveBeenCalledWith(
                    `${storageKey}:channel-peers:${channelId}`,
                    [peerId2]
                )
            })

            it('should delete key when last peer is removed', async () => {
                mockStorage.getItem.mockResolvedValueOnce([peerId1])

                await kvLayer.removePeerFromChannel(channelId, peerId1)

                expect(mockStorage.removeItem).toHaveBeenCalledWith(
                    `${storageKey}:channel-peers:${channelId}`
                )
                expect(mockStorage.setItem).not.toHaveBeenCalled()
            })

            it('should handle non-existent peer removal', async () => {
                mockStorage.getItem.mockResolvedValueOnce([peerId1])

                await kvLayer.removePeerFromChannel(channelId, 'non-existent')

                expect(mockStorage.setItem).toHaveBeenCalledWith(
                    `${storageKey}:channel-peers:${channelId}`,
                    [peerId1]
                )
            })
        })

        describe('getChannelPeers', () => {
            it('should retrieve channel peers', async () => {
                mockStorage.getItem.mockResolvedValueOnce([peerId1, peerId2])

                const result = await kvLayer.getChannelPeers(channelId)

                expect(result).toEqual([peerId1, peerId2])
            })

            it('should return empty array for channel with no peers', async () => {
                mockStorage.getItem.mockResolvedValueOnce(null)

                const result = await kvLayer.getChannelPeers(channelId)

                expect(result).toEqual([])
            })

            it('should return empty array on error', async () => {
                mockStorage.getItem.mockRejectedValueOnce(new Error('Failed'))

                const result = await kvLayer.getChannelPeers(channelId)

                expect(result).toEqual([])
            })
        })
    })

    describe('activity updates', () => {
        it('should update channel activity timestamp', async () => {
            const channelId = 'channel-123'
            const initialTime = 1000000
            const mockChannel: PersistedChannel = {
                channel_uuid: channelId,
                subscribers: new Map(),
                created_at: initialTime,
                last_activity: initialTime,
                metadata: {}
            }

            vi.useFakeTimers()
            vi.setSystemTime(initialTime)

            mockStorage.getItem.mockResolvedValueOnce(mockChannel)

            vi.setSystemTime(initialTime + 5000)

            await kvLayer.updateChannelActivity(channelId)

            expect(mockStorage.setItem).toHaveBeenCalledWith(
                `${storageKey}:channels:${channelId}`,
                expect.objectContaining({
                    channel_uuid: channelId,
                    last_activity: initialTime + 5000
                })
            )

            const updatedChannel = mockStorage.setItem.mock.calls[0][1]
            expect(updatedChannel.last_activity).toBeGreaterThan(mockChannel.last_activity)

            vi.useRealTimers()
        })

        it('should handle non-existent channel gracefully', async () => {
            mockStorage.getItem.mockResolvedValueOnce(null)

            // Should not throw
            await kvLayer.updateChannelActivity('non-existent')

            expect(mockStorage.setItem).not.toHaveBeenCalled()
        })

        it('should update subscription activity timestamp', async () => {
            const peerId = 'peer-123'
            const mockSubscription: PersistedSubscription = {
                peer_id: peerId,
                channels: ['channel-1'],
                filters: {},
                subscribed_at: Date.now(),
                last_activity: Date.now() - 10000
            }

            mockStorage.getItem.mockResolvedValueOnce(mockSubscription)

            await kvLayer.updateSubscriptionActivity(peerId)

            expect(mockStorage.setItem).toHaveBeenCalledWith(
                `${storageKey}:subscriptions:${peerId}`,
                expect.objectContaining({
                    peer_id: peerId,
                    last_activity: expect.any(Number)
                })
            )
        })
    })

    describe('cleanup operations', () => {
        it('should cleanup expired entries', async () => {
            const expiredKey = `${storageKey}:channels:expired`
            const validKey = `${storageKey}:channels:valid`

            mockStorage.getKeys
                .mockResolvedValueOnce([expiredKey, validKey])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])

            mockStorage.getItem
                .mockResolvedValueOnce({
                    data: {},
                    expiresAt: Date.now() - 1000
                })
                .mockResolvedValueOnce({
                    data: {},
                    expiresAt: Date.now() + 10000
                })

            await kvLayer.cleanup()

            expect(mockStorage.removeItem).toHaveBeenCalledWith(expiredKey)
            expect(mockStorage.removeItem).not.toHaveBeenCalledWith(validKey)
        })

        it('should cleanup empty channels older than 24 hours', async () => {
            const oldChannel: PersistedChannel = {
                channel_uuid: 'old-channel',
                subscribers: new Map(),
                created_at: Date.now() - (25 * 60 * 60 * 1000),
                last_activity: Date.now() - (25 * 60 * 60 * 1000),
                metadata: {}
            }

            mockStorage.getKeys
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([`${storageKey}:channels:old-channel`])

            mockStorage.getItem
                .mockResolvedValueOnce(oldChannel)

            mockStorage.getItem
                .mockResolvedValueOnce([])

            await kvLayer.cleanup()

            expect(mockStorage.removeItem).toHaveBeenCalledWith(
                `${storageKey}:channels:old-channel`
            )
            expect(mockStorage.removeItem).toHaveBeenCalledWith(
                `${storageKey}:channel-peers:old-channel`
            )
        })

        it('should not cleanup recent empty channels', async () => {
            const recentChannel: PersistedChannel = {
                channel_uuid: 'recent-channel',
                subscribers: new Map(),
                created_at: Date.now() - (1 * 60 * 60 * 1000),
                last_activity: Date.now() - (1 * 60 * 60 * 1000),
                metadata: {}
            }

            mockStorage.getKeys
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([`${storageKey}:channels:recent-channel`])

            mockStorage.getItem
                .mockResolvedValueOnce(recentChannel)
                .mockResolvedValueOnce([])

            await kvLayer.cleanup()

            expect(mockStorage.removeItem).not.toHaveBeenCalledWith(
                `${storageKey}:channels:recent-channel`
            )
        })
    })

    describe('getStorageStats', () => {
        it('should return storage statistics', async () => {
            const channel1: PersistedChannel = {
                channel_uuid: 'channel-1',
                subscribers: new Map(),
                created_at: Date.now(),
                last_activity: Date.now(),
                metadata: {}
            }

            const channel2: PersistedChannel = {
                channel_uuid: 'channel-2',
                subscribers: new Map(),
                created_at: Date.now(),
                last_activity: Date.now(),
                metadata: {}
            }

            const sub1: PersistedSubscription = {
                peer_id: 'peer-1',
                channels: ['channel-1'],
                filters: {},
                subscribed_at: Date.now(),
                last_activity: Date.now()
            }

            mockStorage.getKeys
                .mockResolvedValueOnce([
                    `${storageKey}:channels:channel-1`,
                    `${storageKey}:channels:channel-2`
                ])

            mockStorage.getItem
                .mockResolvedValueOnce(channel1)
                .mockResolvedValueOnce(channel2)

            mockStorage.getKeys
                .mockResolvedValueOnce([`${storageKey}:subscriptions:peer-1`])

            mockStorage.getItem
                .mockResolvedValueOnce(sub1)

            mockStorage.getItem
                .mockResolvedValueOnce(['peer-1'])
                .mockResolvedValueOnce([])

            mockStorage.getKeys
                .mockResolvedValueOnce([
                    `${storageKey}:channel-peers:channel-1`,
                    `${storageKey}:channel-peers:orphaned-channel`
                ])

            const stats = await kvLayer.getStorageStats()

            expect(stats).toEqual({
                totalChannels: 2,
                totalSubscriptions: 1,
                channelsWithPeers: 1,
                orphanedPeerMappings: 1
            })
        })

        it('should return zeros on error', async () => {
            mockStorage.getKeys.mockRejectedValueOnce(new Error('Failed'))

            const stats = await kvLayer.getStorageStats()

            expect(stats).toEqual({
                totalChannels: 0,
                totalSubscriptions: 0,
                channelsWithPeers: 0,
                orphanedPeerMappings: 0
            })
        })
    })
})