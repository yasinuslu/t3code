import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  formatThreadLinkHref,
  formatThreadMarkdownLink,
  parseThreadLinkHref,
} from "./threadLinks.ts";

const target = {
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("mcp:c1097b24-5e1a-4c2b-9d0f-7f1a2b3c4d5e"),
};

describe("thread links", () => {
  it("round-trips ids that contain reserved characters", () => {
    const href = formatThreadLinkHref(target);
    expect(href).toBe("t3code://threads/env-1/mcp%3Ac1097b24-5e1a-4c2b-9d0f-7f1a2b3c4d5e");
    expect(parseThreadLinkHref(href)).toEqual(target);
    const odd = { environmentId: EnvironmentId.make("a/b c"), threadId: ThreadId.make("x(1)?#") };
    expect(parseThreadLinkHref(formatThreadLinkHref(odd))).toEqual(odd);
  });

  it("reads the short t3://thread form and unencoded colons", () => {
    expect(
      parseThreadLinkHref("t3://thread/env-1/mcp%3Ac1097b24-5e1a-4c2b-9d0f-7f1a2b3c4d5e"),
    ).toEqual(target);
    expect(parseThreadLinkHref(`t3://thread/env-1/${target.threadId}`)).toEqual(target);
  });

  it("rejects other links and malformed paths", () => {
    for (const href of [
      "https://example.com/threads/env-1/t-1",
      "t3code://threads/env-1",
      "t3code://threads/env-1/t-1/extra",
      "t3code://threads/env-1/t-1?x=1",
      "t3code://settings/usage",
      "t3://thread/%E0%A4%A/t-1",
      "t3://thread/%20/t-1",
    ]) {
      expect(parseThreadLinkHref(href)).toBeNull();
    }
  });

  it("formats markdown with an escaped, single-line title", () => {
    expect(formatThreadMarkdownLink({ ...target, title: "Fix [bug]\n in parser" })).toBe(
      "[Fix \\[bug\\] in parser](t3code://threads/env-1/mcp%3Ac1097b24-5e1a-4c2b-9d0f-7f1a2b3c4d5e)",
    );
    expect(formatThreadMarkdownLink({ ...target, title: "  " })).toMatch(/^\[Thread\]\(/);
  });
});
