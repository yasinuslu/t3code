import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { providerLimitHint } from "./providerLimitHint";

const now = Date.parse("2026-10-13T12:00:00.000Z");
const limits = (windows: Array<{ id: string; usedPercent: number; resetsAt?: string }>) =>
  ({
    usageLimits: {
      checkedAt: "2026-10-13T11:59:00.000Z",
      windows: windows.map((window) => ({ kind: "session", label: window.id, ...window })),
    },
  }) as Pick<ServerProvider, "usageLimits">;

describe("providerLimitHint", () => {
  it("names the reset of an exhausted window", () => {
    const provider = limits([
      { id: "five_hour", usedPercent: 100, resetsAt: "2026-10-13T15:05:00.000Z" },
    ]);
    expect(providerLimitHint(provider, undefined, now)).toBe("Limit reached · resets in 3h 5m");
  });

  it("is null while the account has room or no limits are known", () => {
    expect(providerLimitHint({}, undefined, now)).toBeNull();
    expect(
      providerLimitHint(
        limits([{ id: "five_hour", usedPercent: 80, resetsAt: "2026-10-13T15:05:00.000Z" }]),
        undefined,
        now,
      ),
    ).toBeNull();
  });

  it("only counts a model-scoped window for that model", () => {
    const provider = limits([
      { id: "seven_day_opus", usedPercent: 100, resetsAt: "2026-10-14T12:00:00.000Z" },
    ]);
    expect(providerLimitHint(provider, "claude-sonnet-4", now)).toBeNull();
    expect(providerLimitHint(provider, "claude-opus-4", now)).toMatch(
      /^Limit reached · resets in /,
    );
  });
});
