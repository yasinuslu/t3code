import { describe, expect, it } from "vitest";

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
});
