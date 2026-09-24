import { assert, describe, it } from "@effect/vitest";

import { normalizeGitCodePullRequest, parseGitCodeRemoteUrl } from "./GitCodeApi.ts";

describe("parseGitCodeRemoteUrl", () => {
  it("reads owner and repository from SSH and HTTPS remotes", () => {
    const expected = { owner: "Turkey-PC-Migration", repo: "hdc_manager" };
    assert.deepStrictEqual(
      parseGitCodeRemoteUrl("git@gitcode.com:Turkey-PC-Migration/hdc_manager.git"),
      expected,
    );
    assert.deepStrictEqual(
      parseGitCodeRemoteUrl("https://gitcode.com/Turkey-PC-Migration/hdc_manager.git"),
      expected,
    );
  });
});

describe("normalizeGitCodePullRequest", () => {
  const pullRequest = {
    number: 3,
    title: "Port",
    html_url: "https://gitcode.com/org/repo/pull/3",
    state: "closed",
    created_at: "2026-09-01T10:00:00.000+08:00",
    merged_at: "2026-09-02T10:00:00.000+08:00",
    head: { ref: "feature", repo: { full_path: "fork/repo" } },
    base: { ref: "main", repo: { namespace: { path: "org" }, path: "repo" } },
  };

  it("treats a pull request with a merge time as merged, and a fork head as cross-repository", () => {
    const normalized = normalizeGitCodePullRequest(pullRequest);
    assert.strictEqual(normalized.state, "merged");
    assert.strictEqual(normalized.isCrossRepository, true);
    assert.strictEqual(normalized.headRepositoryNameWithOwner, "fork/repo");
    assert.strictEqual(normalized.headRepositoryOwnerLogin, "fork");
  });

  it("reads a documented display name as no repository rather than a wrong one", () => {
    const normalized = normalizeGitCodePullRequest({
      ...pullRequest,
      head: { ref: "feature", repo: { full_name: "org / repo" } },
    });
    assert.strictEqual(normalized.headRepositoryNameWithOwner, undefined);
    assert.strictEqual(normalized.isCrossRepository, undefined);
  });
});
