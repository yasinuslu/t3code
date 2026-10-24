import { describe, expect, it } from "vite-plus/test";

import { forgejoChecks, resolveForgejoTargetUrl } from "./forgejoPullRequestJson.ts";

const PR_URL = "https://git.nepjua.org/Selfmerce/Selfmerce/pulls/9";

describe("resolveForgejoTargetUrl", () => {
  it("resolves a site-relative Actions URL against the forge origin", () => {
    expect(resolveForgejoTargetUrl("/Selfmerce/Selfmerce/actions/runs/31/jobs/4", PR_URL)).toBe(
      "https://git.nepjua.org/Selfmerce/Selfmerce/actions/runs/31/jobs/4",
    );
  });

  it("keeps absolute URLs and drops empty ones", () => {
    expect(resolveForgejoTargetUrl("https://ci.example.com/run/1", PR_URL)).toBe(
      "https://ci.example.com/run/1",
    );
    expect(resolveForgejoTargetUrl("", PR_URL)).toBeNull();
    expect(resolveForgejoTargetUrl(null, PR_URL)).toBeNull();
  });
});

describe("forgejoChecks", () => {
  it("emits absolute check URLs", () => {
    const [check] = forgejoChecks(
      [
        {
          context: "ci / test",
          status: "success",
          description: null,
          target_url: "/Selfmerce/Selfmerce/actions/runs/31/jobs/4",
          updated_at: "2026-10-19T10:00:00Z",
        },
      ],
      PR_URL,
    );
    expect(check?.url).toBe("https://git.nepjua.org/Selfmerce/Selfmerce/actions/runs/31/jobs/4");
  });

  it("reads a finished run with a skipped job as finished", () => {
    // The statuses Forgejo returned for a green t3code PR whose ship job only runs on dev.
    const status = (context: string, state: string, at: string) => ({
      context: `Nix desktop build (linux) / ${context} (pull_request)`,
      status: state,
      description: null,
      target_url: null,
      updated_at: at,
    });
    const checks = forgejoChecks(
      [
        status("build", "success", "2026-10-23T16:05:42Z"),
        status("ship", "skipped", "2026-10-23T16:05:42Z"),
        status("build", "pending", "2026-10-23T15:57:38Z"),
        status("ship", "pending", "2026-10-23T15:57:37Z"),
      ],
      PR_URL,
    );
    expect(checks.map((check) => check.status).toSorted()).toEqual(["skipped", "success"]);
  });
});
