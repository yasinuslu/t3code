import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { ForgejoComment, forgejoChecks, forgejoComment } from "./forgejoPullRequestJson.ts";

const decodeForgejoComment = Schema.decodeSync(ForgejoComment);

describe("forgejoComment", () => {
  const createdAt = "2026-10-10T19:52:40Z";
  const comment = (updatedAt: string | null | undefined) =>
    forgejoComment(
      decodeForgejoComment({
        id: 29061,
        body: "Performance: five rounds complete",
        user: { login: "forgejo-actions" },
        created_at: createdAt,
        ...(updatedAt === undefined ? {} : { updated_at: updatedAt }),
      }),
    );

  it.each([undefined, null, createdAt, "2026-10-10T19:52:40.000Z"])(
    "reads no edit from an updated_at of %s",
    (updatedAt) => {
      const mapped = comment(updatedAt);
      assert.strictEqual(mapped.createdAt, "2026-10-10T19:52:40.000Z");
      assert.isUndefined(mapped.editedAt);
    },
  );

  it("reads a later updated_at as an edit, in UTC milliseconds", () => {
    const mapped = comment("2026-10-10T20:04:50Z");
    assert.strictEqual(mapped.id, "29061");
    assert.strictEqual(mapped.author?.login, "forgejo-actions");
    assert.strictEqual(mapped.editedAt, "2026-10-10T20:04:50.000Z");
  });
});

describe("forgejoChecks", () => {
  const PR_URL = "https://forge.example.com/owner/repo/pulls/9";
  const status = (context: string, state: string, at: string, targetUrl: string | null = null) => ({
    context,
    status: state,
    description: null,
    target_url: targetUrl,
    updated_at: at,
  });

  it("resolves site-relative Actions URLs against the forge and keeps absolute ones", () => {
    const checks = forgejoChecks(
      [
        status("a", "success", "2026-10-19T10:00:00Z", "/owner/repo/actions/runs/31/jobs/4"),
        status("b", "success", "2026-10-19T10:00:00Z", "https://ci.example.com/run/1"),
      ],
      PR_URL,
    );
    assert.deepStrictEqual(
      checks.map((check) => check.url),
      [
        "https://forge.example.com/owner/repo/actions/runs/31/jobs/4",
        "https://ci.example.com/run/1",
      ],
    );
  });

  it("keeps the newer status when two land in the same second", () => {
    const at = "2026-10-23T16:05:42Z";
    // The API lists newest first.
    const [check] = forgejoChecks(
      [status("ship", "skipped", at), status("ship", "pending", at)],
      PR_URL,
    );
    assert.strictEqual(check?.status, "skipped");
  });
});
