import { recognizeRemoteWith } from "@t3tools/source-control-core/shared/definition";
import { describe, expect, it } from "vite-plus/test";

import { definition, parsePullRequestUrl } from "./definition.ts";

describe("GitCode change request URLs", () => {
  it("parses current and older pull request paths", () => {
    const expected = { host: "gitcode.com", repository: "owner/repo", number: 7 };
    expect(parsePullRequestUrl("https://gitcode.com/Owner/Repo/pull/7")).toMatchObject(expected);
    expect(parsePullRequestUrl("https://gitcode.com/owner/repo/merge_requests/7")).toMatchObject(
      expected,
    );
    expect(
      definition.changeRequestUrl({ host: "gitcode.com", repository: "owner/repo", number: 7 }),
    ).toBe("https://gitcode.com/owner/repo/pull/7");
  });

  it("leaves other hosts' links alone", () => {
    expect(parsePullRequestUrl("https://github.com/owner/repo/pull/7")).toBeNull();
    expect(parsePullRequestUrl("https://notgitcode.com/owner/repo/pull/7")).toBeNull();
  });
});

describe("GitCode remotes", () => {
  it("recognises GitCode and AtomGit remotes", () => {
    expect(
      recognizeRemoteWith(definition, "git@gitcode.com:Turkey-PC-Migration/jmeter.git"),
    ).toEqual({ kind: "gitcode", name: "GitCode", baseUrl: "https://gitcode.com" });
    expect(recognizeRemoteWith(definition, "https://atomgit.com/owner/repo.git")?.kind).toBe(
      "gitcode",
    );
    expect(recognizeRemoteWith(definition, "https://notgitcode.com/owner/repo.git")).toBeNull();
  });
});
