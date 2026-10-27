import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import {
  formatThreadDeepLink,
  formatThreadLink,
  parseThreadDeepLink,
  parseThreadLinkHref,
  relabelThreadLinks,
  resolveThreadLinkRef,
} from "./threadLinks.ts";

const ref = (environmentId: string, threadId = "chat-1") => ({
  environmentId: EnvironmentId.make(environmentId),
  threadId: ThreadId.make(threadId),
});

describe("thread link destinations", () => {
  it("prefers the local literal id, then the local decoded id, over remote matches", () => {
    const source = ref("local", "provider%3A1");
    const decoded = ref("local", "provider:1");
    const remote = ref("remote", "provider%3A1");
    expect(resolveThreadLinkRef(source, [remote, decoded, source])).toEqual(source);
    expect(resolveThreadLinkRef(source, [remote, decoded])).toEqual(decoded);
  });

  it("opens the unique matching chat in another environment", () => {
    const destination = ref("remote");
    expect(resolveThreadLinkRef(ref("local"), [ref("local", "other-chat"), destination])).toEqual(
      destination,
    );
  });

  it("leaves ambiguous or missing destinations unresolved", () => {
    const source = ref("local", "provider%3A1");
    const literal = ref("remote", "provider%3A1");
    const decoded = ref("remote", "provider:1");
    expect(
      resolveThreadLinkRef(source, [literal, ref("other-remote", literal.threadId), decoded]),
    ).toBeNull();
    expect(
      resolveThreadLinkRef(source, [decoded, ref("other-remote", decoded.threadId)]),
    ).toBeNull();
    expect(resolveThreadLinkRef(source, [ref("remote", "other-chat")])).toBeNull();
  });
});

describe("thread links", () => {
  it("takes the thread id verbatim, percent escapes included", () => {
    expect(parseThreadLinkHref("t3-thread://v1/mcp:1234")).toBe("mcp:1234");
    expect(parseThreadLinkHref("t3-thread://v1/thread:delegated-task:mcp%3A1")).toBe(
      "thread:delegated-task:mcp%3A1",
    );
  });

  it("rejects other links and an empty id", () => {
    expect(parseThreadLinkHref("https://t3.codes")).toBeNull();
    expect(parseThreadLinkHref("t3-thread://v1/")).toBeNull();
    expect(parseThreadLinkHref("t3-thread://v1/ ")).toBeNull();
  });

  it("resolves a percent-encoded id when the id as written names no thread", () => {
    const titles = new Map([
      ["thread:project:1", "Decoded"],
      ["provider%3A1", "Literal escape"],
    ]);
    expect(
      relabelThreadLinks(
        "[a](t3-thread://v1/thread%3Aproject%3A1) [b](t3-thread://v1/provider%3A1)",
        (threadId) => titles.get(threadId),
      ),
    ).toBe(
      "[Decoded](t3-thread://v1/thread:project:1) [Literal escape](t3-thread://v1/provider%3A1)",
    );
    const untitled = new Map([
      ["a%3A1", ""],
      ["a:1", "Other"],
    ]);
    expect(
      relabelThreadLinks("[Kept](t3-thread://v1/a%3A1)", (threadId) => untitled.get(threadId)),
    ).toBe("[Kept](t3-thread://v1/a%3A1)");
  });

  it("leaves links inside code spans and fences as written", () => {
    const markdown = [
      "Live [old](t3-thread://v1/t1), literal `[old](t3-thread://v1/t1)`.",
      "```md",
      "[old](t3-thread://v1/t1)",
      "```",
      "After [old](t3-thread://v1/t1)",
    ].join("\n");
    expect(relabelThreadLinks(markdown, () => "New")).toBe(
      [
        "Live [New](t3-thread://v1/t1), literal `[old](t3-thread://v1/t1)`.",
        "```md",
        "[old](t3-thread://v1/t1)",
        "```",
        "After [New](t3-thread://v1/t1)",
      ].join("\n"),
    );
  });

  it("writes the thread id verbatim so the link opens that exact thread", () => {
    const link = formatThreadLink("thread:delegated-task:mcp%3A1", "Fix");
    expect(link).toBe("[Fix](t3-thread://v1/thread:delegated-task:mcp%3A1)");
    expect(parseThreadLinkHref(link.slice(link.indexOf("](") + 2, -1))).toBe(
      "thread:delegated-task:mcp%3A1",
    );
  });

  it("formats a label that would otherwise break the Markdown link", () => {
    expect(formatThreadLink("t1", "Fix [ci] \\ build")).toBe("[Fix ci build](t3-thread://v1/t1)");
    expect(formatThreadLink("t1", " ] ")).toBe("[t1](t3-thread://v1/t1)");
  });
});

describe("thread deep links", () => {
  const target = {
    environmentId: EnvironmentId.make("env-1"),
    threadId: ThreadId.make("mcp:c1097b24-5e1a-4c2b-9d0f-7f1a2b3c4d5e"),
  };

  it("round-trips ids that contain reserved characters", () => {
    const href = formatThreadDeepLink(target);
    expect(href).toBe("t3code://threads/env-1/mcp%3Ac1097b24-5e1a-4c2b-9d0f-7f1a2b3c4d5e");
    expect(parseThreadDeepLink(href)).toEqual(target);
    const odd = { environmentId: EnvironmentId.make("a/b c"), threadId: ThreadId.make("x(1)?#") };
    expect(parseThreadDeepLink(formatThreadDeepLink(odd))).toEqual(odd);
  });

  it("reads the short t3://thread form, and chat reads both as thread links", () => {
    expect(parseThreadDeepLink(`t3://thread/env-1/${target.threadId}`)).toEqual(target);
    expect(parseThreadLinkHref(formatThreadDeepLink(target))).toBe(target.threadId);
  });

  it("rejects other links and malformed paths", () => {
    for (const href of [
      "https://example.com/threads/env-1/t-1",
      "t3code://threads/env-1",
      "t3code://threads/env-1/t-1/extra",
      "t3code://threads/env-1/t-1?x=1",
      "t3://thread/%E0%A4%A/t-1",
      "t3://thread/%20/t-1",
    ]) {
      expect(parseThreadDeepLink(href)).toBeNull();
    }
  });
});
