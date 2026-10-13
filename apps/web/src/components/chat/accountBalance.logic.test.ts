import { type CodeProfile, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { accountBalanceForLaunch } from "./accountBalance.logic";

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
