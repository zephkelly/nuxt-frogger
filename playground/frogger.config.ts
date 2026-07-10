import { defineFroggerOptions, defineScrub, RECOMMENDED_RULES, metricFileTransport, metricMemoryTransport } from '#frogger/config';

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

    // Static base context stamped onto every ambient `frogger.*` log at boot,
    // no plugin required. Must be serializable (no functions). For runtime-only
    // values (tenant, per-deployment env) register a client plugin that taps the
    // `frogger:init` hook and calls `frogger.addContext(...)`.
    // context: { service: 'playground', region: 'local' },

    serverModule: true,
    clientModule: true,

    // Frogger ships quiet: a bare install (preset 'minimal') logs to the
    // console only. The heavy subsystems — scrubbing, rate limiting, the dev
    // websocket live-stream and global error capture — are opt-in via `preset`.
    //
    // The playground uses `full` so the /live-logs page (which needs the dev
    // websocket) and every other feature work out of the box. Other presets:
    //   'minimal'  — console only
    //   'standard' — adds scrubbing, rate limiting and error capture (no websocket)
    //   'full'     — everything on, including the dev websocket live-stream
    preset: 'full',

    // Persistent destinations are opt-in and orthogonal to the preset. Add a
    // `fileTransport()` to restore rotated JSON-lines files under `logs/`, an
    // `httpTransport()` to forward to any HTTP ingest, or an `observeTransport()`
    // to ship to a nuxt-observe deployment. Import them from '#frogger/config':
    //
    //   import { fileTransport, observeTransport } from '#frogger/config';
    //
    //   transports: [
    //     fileTransport(),                                             // logs/ on disk
    //     observeTransport({ url: 'https://observe.app.com', key }),   // relay to observe
    //   ],

    // Scrubbing is fully opt-in: enabling it (here via `preset: 'full'`) turns
    // the engine on but adds NO rules — nothing is scrubbed until you declare a
    // rule. Compose rules with the `defineScrub()` builder, pulling in the
    // ready-made `RECOMMENDED_RULES` bundle and adding app-specific redactions.
    // The /scrubbing demo relies on these rules being active.
    scrub: defineScrub()
        .use(...RECOMMENDED_RULES)
        .redact('authToken', /.*secret.*/i)
        .build(),

    // Metrics are a separate, opt-in subsystem (never part of a preset). Turned
    // on here so the /metrics demo page collects Web Vitals + device stats.
    // Raw metric events are written to logs/metrics/ and also captured in memory
    // (named 'playground') so the e2e/testing helpers can read them back.
    metrics: {
        transports: [
            metricFileTransport(),
            metricMemoryTransport({ name: 'playground' }),
        ],
    },

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
