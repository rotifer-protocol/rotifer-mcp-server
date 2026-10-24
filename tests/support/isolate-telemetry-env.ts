/**
 * Runs before every test file (vitest.config.ts `setupFiles`).
 *
 * The opt-out variables telemetry/consent.ts reads come from whoever runs the
 * suite. A developer with DO_NOT_TRACK=1 in their shell — a common setting —
 * saw 21 reporting tests fail, every one because nothing was sent, which reads
 * exactly like a reporting bug. Tests that exercise the opt-out set these
 * variables themselves; everything else starts from "not opted out".
 *
 * Child processes spawned by the real-stdio integration tests inherit
 * process.env, so they start clean too.
 */
delete process.env.DO_NOT_TRACK;
delete process.env.ROTIFER_TELEMETRY;
