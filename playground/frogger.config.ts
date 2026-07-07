import { defineFroggerOptions } from '#frogger/config';

/**
 * Playground Frogger config.
 *
 * This file doubles as a living reference — the active options keep the
 * playground working end-to-end, and the commented blocks show how you'd
 * customise scrubbing and rate limiting in a real app.
 *
 * Note: the client beams its logs to the module's ingest route
 * (`/api/_frogger/logs`). Do NOT override `public.endpoint` here unless you
 * also register a handler at that path — otherwise client logs 404.
 */
export default defineFroggerOptions({
    app: {
        name: 'frogger-playground',
        version: '1.0.0',
    },

    serverModule: true,
    clientModule: true,

    // Frogger ships quiet: a bare install (preset 'minimal') logs to file +
    // console only. The heavy subsystems — scrubbing, rate limiting, the dev
    // websocket live-stream and global error capture — are opt-in.
    //
    // The playground uses `full` so the /live-logs page (which needs the dev
    // websocket) and every other feature work out of the box. Other presets:
    //   'minimal'  — file + console only
    //   'standard' — adds scrubbing, rate limiting and error capture (no websocket)
    //   'full'     — everything on, including the dev websocket live-stream
    preset: 'full',

    // Individual options always win over the preset. Pass custom scrub rules to
    // extend the defaults:
    // scrub: {
    //     maxDepth: 10,
    //     deepScrub: true,
    //     rules: [
    //         {
    //             action: 'redact_full',
    //             fieldPatterns: ['authToken', /.*secret.*/i],
    //             priority: 100,
    //             description: 'Redact app-specific secrets',
    //         },
    //     ],
    // },

    // Tune the per-IP / per-app rate-limit tiers here:
    // rateLimit: {
    //     limits: { perIp: 100, perApp: 30 },
    //     windows: { perIp: 60, perApp: 60 },
    //     blocking: {
    //         enabled: true,
    //         escalationResetHours: 24,
    //         finalBanHours: 12,
    //         violationsBeforeBlock: 3,
    //         timeouts: [60, 300, 1800],
    //     },
    // },
});
