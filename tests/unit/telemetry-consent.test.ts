import { describe, it, expect } from "vitest";
import { telemetryOptedOutByEnv, telemetryExplicitlyOnByEnv } from "../../src/telemetry/consent.js";

/**
 * Mirrors rotifer-playground's tests/unit/telemetry-consent.test.ts exactly —
 * same assertions, because this file is a deliberate line-for-line copy of
 * that package's src/telemetry/consent.ts (see that file's header for why).
 * If these two test files ever assert different things, the two consent.ts
 * copies have already drifted and a user's ROTIFER_TELEMETRY=0 means
 * different things depending which binary they're running.
 */
describe("telemetryOptedOutByEnv", () => {
  it("is false when nothing is set", () => {
    expect(telemetryOptedOutByEnv({})).toBe(false);
  });

  it.each(["1", "true", "yes", "anything-non-empty"])(
    "DO_NOT_TRACK=%j opts out",
    (v) => {
      expect(telemetryOptedOutByEnv({ DO_NOT_TRACK: v })).toBe(true);
    },
  );

  it.each(["0", "false", "", undefined])(
    "DO_NOT_TRACK=%j does NOT opt out on its own",
    (v) => {
      const env = v === undefined ? {} : { DO_NOT_TRACK: v };
      expect(telemetryOptedOutByEnv(env)).toBe(false);
    },
  );

  it.each(["0", "false", "off", "OFF", " off "])(
    "ROTIFER_TELEMETRY=%j opts out",
    (v) => {
      expect(telemetryOptedOutByEnv({ ROTIFER_TELEMETRY: v })).toBe(true);
    },
  );

  it("ROTIFER_TELEMETRY=1 does not opt out", () => {
    expect(telemetryOptedOutByEnv({ ROTIFER_TELEMETRY: "1" })).toBe(false);
  });

  it("DO_NOT_TRACK wins even when ROTIFER_TELEMETRY explicitly asks for on", () => {
    expect(
      telemetryOptedOutByEnv({ DO_NOT_TRACK: "1", ROTIFER_TELEMETRY: "1" }),
    ).toBe(true);
  });
});

describe("telemetryExplicitlyOnByEnv", () => {
  it("is false when nothing is set — 'unset' is not 'explicitly on'", () => {
    expect(telemetryExplicitlyOnByEnv({})).toBe(false);
  });

  it.each(["1", "true", "on", "yes"])("ROTIFER_TELEMETRY=%j is explicit on", (v) => {
    expect(telemetryExplicitlyOnByEnv({ ROTIFER_TELEMETRY: v })).toBe(true);
  });

  it("is false when ROTIFER_TELEMETRY says off", () => {
    expect(telemetryExplicitlyOnByEnv({ ROTIFER_TELEMETRY: "0" })).toBe(false);
  });

  it("DO_NOT_TRACK vetoes an explicit ROTIFER_TELEMETRY=1", () => {
    expect(
      telemetryExplicitlyOnByEnv({ DO_NOT_TRACK: "1", ROTIFER_TELEMETRY: "1" }),
    ).toBe(false);
  });
});
