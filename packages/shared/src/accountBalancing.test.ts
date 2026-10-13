import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  accountRoom,
  balancedAccountGroup,
  observedLimitKey,
  rankBalancedAccounts,
} from "./accountBalancing.ts";

const now = Date.parse("2026-10-13T12:00:00.000Z");
const claude = ProviderInstanceId.make("claude");
const claude2 = ProviderInstanceId.make("claude_2");
const codex = ProviderInstanceId.make("codex");

function usageWindow(
  id: string,
  usedPercent: number,
  resetsAt = "2026-10-13T15:00:00.000Z",
): ServerProviderUsageWindow {
  return { id, kind: "session", label: id, usedPercent, resetsAt };
}

function provider(
  instanceId: ProviderInstanceId,
  driver: string,
  overrides: Partial<ServerProvider> = {},
  windows: ReadonlyArray<ServerProviderUsageWindow> = [],
): ServerProvider {
  return {
    instanceId,
    driver: ProviderDriverKind.make(driver),
    displayName: instanceId,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-13T11:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...(windows.length === 0
      ? {}
      : { usageLimits: { checkedAt: "2026-10-13T11:59:00.000Z", windows } }),
    ...overrides,
  };
}

const selection = { instanceId: claude, model: "claude-opus-5-5" };
const rank = (
  providers: ReadonlyArray<ServerProvider>,
  options: Partial<Parameters<typeof rankBalancedAccounts>[0]> = {},
) =>
  rankBalancedAccounts({
    accounts: [{ instanceId: claude }, { instanceId: claude2 }, { instanceId: codex }],
    providers,
    selection,
    observedLimits: new Map(),
    now,
    ...options,
  });

describe("accountRoom", () => {
  it("is the tightest live window that applies to the model", () => {
    const limits = {
      checkedAt: "2026-10-13T11:59:00.000Z",
      windows: [
        usageWindow("five_hour", 40),
        usageWindow("seven_day", 70),
        usageWindow("seven_day_sonnet", 95),
        // Reset already passed: the snapshot is stale, not full.
        usageWindow("stale", 100, "2026-10-13T11:00:00.000Z"),
      ],
    };
    expect(accountRoom(limits, "claude-opus-5-5", now)).toBeCloseTo(0.3);
    expect(accountRoom(limits, "claude-sonnet-5-5", now)).toBeCloseTo(0.05);
    expect(accountRoom(undefined, "claude-opus-5-5", now)).toBe(1);
  });
});

describe("rankBalancedAccounts", () => {
  it("puts the account with more quota left first and keeps the model", () => {
    const { ranked } = rank([
      provider(claude, "claudeAgent", {}, [usageWindow("five_hour", 80)]),
      provider(claude2, "claudeAgent", {}, [usageWindow("five_hour", 20)]),
    ]);
    expect(ranked.map((account) => account.selection)).toEqual([
      { instanceId: claude2, model: "claude-opus-5-5" },
      { instanceId: claude, model: "claude-opus-5-5" },
    ]);
  });

  it("lets a preferred account win until it has much less room", () => {
    const providers = (used: number) => [
      provider(claude, "claudeAgent", {}, [usageWindow("five_hour", used)]),
      provider(claude2, "claudeAgent", {}, [usageWindow("five_hour", 20)]),
    ];
    const accounts = [{ instanceId: claude, weight: 100 }, { instanceId: claude2 }];
    const first = (used: number) =>
      rank(providers(used), { accounts }).ranked[0]?.instance.instanceId;
    expect(first(50)).toBe(claude);
    expect(first(70)).toBe(claude2);
  });

  it("skips limited accounts, by a full window or a limit a turn hit", () => {
    const providers = [
      provider(claude, "claudeAgent", {}, [
        usageWindow("seven_day", 100, "2026-10-14T07:00:00.000Z"),
      ]),
      provider(claude2, "claudeAgent"),
      provider(codex, "codex", {
        models: [{ slug: "gpt-6", name: "GPT-6", isCustom: false, capabilities: null }],
      }),
    ];
    const byWindow = rank(providers);
    expect(byWindow.ranked.map((account) => account.instance.instanceId)).toEqual([claude2, codex]);
    expect(byWindow.skipped).toEqual([
      {
        instanceId: claude,
        label: claude,
        reason: "limited",
        limitedUntil: Date.parse("2026-10-14T07:00:00.000Z"),
      },
    ]);

    const observed = rank(providers, {
      observedLimits: new Map([[observedLimitKey(claude2, selection.model), now + 60_000]]),
    });
    expect(observed.ranked.map((account) => account.instance.instanceId)).toEqual([codex]);

    // A limit a turn hit on another model leaves this one usable.
    const otherModel = rank(providers, {
      observedLimits: new Map([[observedLimitKey(claude2, "claude-fable-5-1"), now + 60_000]]),
    });
    expect(otherModel.ranked.map((account) => account.instance.instanceId)).toEqual([
      claude2,
      codex,
    ]);
  });

  it("offers other providers after the thread's own, in list order, on their own model", () => {
    const { ranked, skipped } = rank(
      [
        provider(claude, "claudeAgent"),
        provider(claude2, "claudeAgent", { enabled: false }),
        provider(codex, "codex", {
          models: [
            { slug: "gpt-6", name: "GPT-6", isCustom: false, capabilities: null },
            { slug: "gpt-6-mini", name: "GPT-6 mini", isCustom: false, capabilities: null },
          ],
        }),
      ],
      {
        accounts: [
          { instanceId: codex, model: "gpt-6-mini" },
          { instanceId: claude2 },
          { instanceId: ProviderInstanceId.make("gone") },
        ],
        exclude: new Set([claude]),
      },
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.sameDriver).toBe(false);
    expect(ranked[0]?.selection).toEqual({ instanceId: codex, model: "gpt-6-mini" });
    expect(skipped.map((account) => [account.instanceId, account.reason])).toEqual([
      [claude2, "disabled"],
      ["gone", "missing"],
    ]);
  });
});

describe("balancedAccountGroup", () => {
  const providers = [
    provider(claude, "claudeAgent"),
    provider(claude2, "claudeAgent"),
    provider(codex, "codex"),
  ];
  const profile = (
    accounts: ReadonlyArray<{ instanceId: ProviderInstanceId; weight?: number }>,
  ) => ({
    yu: { root: "~/code/yu", accountBalancing: { enabled: true, accounts, includeManager: false } },
  });

  it("is the same-provider accounts a profile lists beside the instance", () => {
    const profiles = profile([
      { instanceId: claude },
      { instanceId: codex },
      { instanceId: claude2 },
    ]);
    expect(
      balancedAccountGroup(profiles, providers, claude2)?.map((entry) => entry.instanceId),
    ).toEqual([claude, claude2]);
    expect(balancedAccountGroup(profiles, providers, codex)).toBeNull();
  });

  it("is null when balancing is off or only one account can be picked", () => {
    expect(
      balancedAccountGroup(
        profile([{ instanceId: claude }, { instanceId: claude2, weight: 0 }]),
        providers,
        claude,
      ),
    ).toBeNull();
    expect(
      balancedAccountGroup(
        {
          yu: {
            root: "~/code/yu",
            accountBalancing: {
              enabled: false,
              accounts: [{ instanceId: claude }, { instanceId: claude2 }],
              includeManager: false,
            },
          },
        },
        providers,
        claude,
      ),
    ).toBeNull();
  });
});
