import { type CodeProfile, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  addBalancedAccount,
  moveBalancedAccount,
  profileWith,
  removeBalancedAccount,
  setBalancedAccountModel,
  setBalancedAccountWeight,
  setBalancingEnabled,
  setBalancingIncludeManager,
} from "./CodeProfileSettings.logic";

const id = (value: string) => ProviderInstanceId.make(value);
const plain: CodeProfile = {
  root: "/work",
  claude: { configDir: "/work/.claude", extraConfigDirs: [] },
};
const ids = (profile: CodeProfile) =>
  profile.accountBalancing?.accounts.map((account) => account.instanceId);

describe("profileWith", () => {
  it("keeps accountBalancing across unrelated edits", () => {
    const accountBalancing = {
      enabled: true,
      accounts: [{ instanceId: id("codex"), weight: 100, model: "gpt-5" }],
      includeManager: true,
    };
    const profile: CodeProfile = { ...plain, accountBalancing };
    expect(profileWith(profile, { root: "/other" })).toEqual({ ...profile, root: "/other" });
    expect(profileWith(profile, { extra: ["/a"] }).accountBalancing).toEqual(accountBalancing);
    expect(
      profileWith({ root: "/work", accountBalancing }, { root: "/x" }).accountBalancing,
    ).toEqual(accountBalancing);
  });

  it("does not add an accountBalancing key to a profile that never had one", () => {
    expect("accountBalancing" in profileWith(plain, { root: "/other" })).toBe(false);
    expect(profileWith({ root: "/work" }, { root: "/other" })).toEqual({ root: "/other" });
  });
});

describe("balancing edits", () => {
  it("starts from a disabled, empty balancing", () => {
    expect(setBalancingEnabled(plain, true).accountBalancing).toEqual({
      enabled: true,
      accounts: [],
      includeManager: false,
    });
    expect(setBalancingIncludeManager(plain, true).accountBalancing?.enabled).toBe(false);
    expect(setBalancingEnabled(plain, true).claude).toEqual(plain.claude);
  });

  it("adds each instance once, in order", () => {
    let profile = addBalancedAccount(plain, id("a"));
    profile = addBalancedAccount(profile, id("b"));
    profile = addBalancedAccount(profile, id("a"));
    expect(profile.accountBalancing?.accounts).toEqual([{ instanceId: "a" }, { instanceId: "b" }]);
  });

  it("moves accounts and stops at the ends", () => {
    let profile = addBalancedAccount(
      addBalancedAccount(addBalancedAccount(plain, id("a")), id("b")),
      id("c"),
    );
    profile = moveBalancedAccount(profile, id("c"), -1);
    expect(ids(profile)).toEqual(["a", "c", "b"]);
    profile = moveBalancedAccount(profile, id("a"), -1);
    profile = moveBalancedAccount(profile, id("b"), 1);
    expect(ids(profile)).toEqual(["a", "c", "b"]);
  });

  it("sets and clears a model without disturbing other accounts", () => {
    let profile = addBalancedAccount(addBalancedAccount(plain, id("a")), id("b"));
    profile = setBalancedAccountModel(profile, id("b"), "m1");
    expect(profile.accountBalancing?.accounts).toEqual([
      { instanceId: "a" },
      { instanceId: "b", model: "m1" },
    ]);
    profile = setBalancedAccountModel(profile, id("b"), undefined);
    expect(profile.accountBalancing?.accounts[1]).toEqual({ instanceId: "b" });
    expect(ids(removeBalancedAccount(profile, id("a")))).toEqual(["b"]);
  });

  it("stores a weight only when it is not Normal", () => {
    let profile = setBalancedAccountWeight(addBalancedAccount(plain, id("a")), id("a"), 100);
    expect(profile.accountBalancing?.accounts).toEqual([{ instanceId: "a", weight: 100 }]);
    profile = setBalancedAccountModel(profile, id("a"), "m");
    profile = setBalancedAccountWeight(profile, id("a"), 50);
    expect(profile.accountBalancing?.accounts).toEqual([{ instanceId: "a", model: "m" }]);
  });
});
