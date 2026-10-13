import {
  type CodeProfile,
  type ModelSelection,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { accountBalanceForLaunch, sendSelectionAvoidingLimit } from "./accountBalance.logic";

const id = (value: string) => ProviderInstanceId.make(value);
const provider = (instanceId: string, driver: string) =>
  ({ instanceId: id(instanceId), driver }) as unknown as ServerProvider;
const providers = [
  provider("claudeAgent", "claudeAgent"),
  provider("claude-2", "claudeAgent"),
  provider("codex", "codex"),
];
const balanced: Record<string, CodeProfile> = {
  work: {
    root: "/work",
    accountBalancing: {
      enabled: true,
      accounts: [{ instanceId: id("claudeAgent") }, { instanceId: id("claude-2") }],
      includeManager: false,
    },
  },
};
const base = {
  isNewThread: true,
  accountSelection: undefined,
  codeProfiles: balanced,
  providers,
  instanceId: id("claudeAgent"),
};

describe("accountBalanceForLaunch", () => {
  it("is auto for a new thread with accounts to balance, unless pinned", () => {
    expect(accountBalanceForLaunch(base)).toBe("auto");
    expect(accountBalanceForLaunch({ ...base, accountSelection: "auto" })).toBe("auto");
    expect(accountBalanceForLaunch({ ...base, accountSelection: "manual" })).toBeUndefined();
  });

  it("is left out when there is nothing to balance or the thread exists", () => {
    expect(accountBalanceForLaunch({ ...base, instanceId: id("codex") })).toBeUndefined();
    expect(accountBalanceForLaunch({ ...base, codeProfiles: {} })).toBeUndefined();
    expect(accountBalanceForLaunch({ ...base, codeProfiles: undefined })).toBeUndefined();
    expect(accountBalanceForLaunch({ ...base, isNewThread: false })).toBeUndefined();
    expect(
      accountBalanceForLaunch({
        ...base,
        codeProfiles: {
          work: {
            ...balanced.work!,
            accountBalancing: { enabled: false, accounts: [], includeManager: false },
          },
        },
      }),
    ).toBeUndefined();
  });
});

describe("sendSelectionAvoidingLimit", () => {
  const now = Date.parse("2026-10-13T12:00:00.000Z");
  const account = (instanceId: string, usedPercent: number, driver = "claudeAgent") =>
    ({
      instanceId: id(instanceId),
      driver,
      displayName: instanceId,
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      models: [],
      usageLimits: {
        checkedAt: "2026-10-13T11:59:00.000Z",
        windows: [
          {
            id: "seven_day",
            kind: "weekly",
            label: "Weekly",
            usedPercent,
            resetsAt: "2026-10-14T12:00:00.000Z",
          },
        ],
      },
    }) as unknown as ServerProvider;
  const selection = (instanceId: string): ModelSelection => ({
    instanceId: id(instanceId),
    model: "claude-opus-5-5",
  });
  const accounts = [
    account("claudeAgent", 100),
    account("claude-2", 40),
    account("claude-3", 10),
    account("codex", 0, "codex"),
  ];

  it("keeps a selection whose account has room", () => {
    const result = sendSelectionAvoidingLimit({
      selection: selection("claude-2"),
      providers: accounts,
      now,
    });
    expect(result.selection.instanceId).toBe("claude-2");
    expect(result.from).toBeNull();
  });

  it("moves a limited account's message to the thread's own account first", () => {
    const result = sendSelectionAvoidingLimit({
      selection: selection("claudeAgent"),
      providers: accounts,
      threadInstanceId: id("claude-2"),
      now,
    });
    expect(result.selection).toEqual(selection("claude-2"));
    expect(result.from?.instanceId).toBe("claudeAgent");
  });

  it("otherwise takes the same-provider account with the most room, never another provider", () => {
    const result = sendSelectionAvoidingLimit({
      selection: selection("claudeAgent"),
      providers: accounts,
      now,
    });
    expect(result.selection.instanceId).toBe("claude-3");
    const allLimited = sendSelectionAvoidingLimit({
      selection: selection("claudeAgent"),
      providers: [
        account("claudeAgent", 100),
        account("claude-2", 100),
        account("codex", 0, "codex"),
      ],
      now,
    });
    expect(allLimited.selection.instanceId).toBe("claudeAgent");
    expect(allLimited.from).toBeNull();
  });
});
