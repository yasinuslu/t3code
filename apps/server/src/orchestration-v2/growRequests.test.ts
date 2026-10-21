import { ComposerContextId, type ComposerContextRecord } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  closeGrowRequests,
  growBlockedAt,
  growRequestFromMessage,
  growRequestsUpdatedAt,
  openGrowRequest,
} from "./growRequests.ts";

const record = (request: "presentation" | "ship" | "change" | "reply"): ComposerContextRecord => ({
  version: 1,
  contextId: ComposerContextId.make(`grow-${request}`),
  kind: "grow-request",
  label: request,
  request,
});

describe("growRequestFromMessage", () => {
  it("keeps the user's words of a change, without the chip", () => {
    const request = growRequestFromMessage(
      "[What if](t3-context://v1/grow-request/grow-change)  make it   blue ",
      [record("change")],
      "2026-10-21T10:00:00.000Z",
    );
    expect(request).toEqual({
      id: "grow-change",
      kind: "change",
      text: "make it blue",
      openedAt: "2026-10-21T10:00:00.000Z",
    });
  });

  it("keeps no text for Ship, and nothing for a message without a request", () => {
    expect(
      growRequestFromMessage(
        "[Ship](t3-context://v1/grow-request/grow-ship)",
        [record("ship")],
        "t",
      )?.text,
    ).toBeUndefined();
    expect(growRequestFromMessage("hello", [], "t")).toBeNull();
  });
});

describe("closeGrowRequests", () => {
  const open = [
    { id: "a", kind: "presentation" as const, openedAt: "2026-10-21T10:00:00.000Z" },
    { id: "b", kind: "ship" as const, openedAt: "2026-10-21T10:01:00.000Z" },
  ];

  it("answers only the requests it is told to, once", () => {
    const at = "2026-10-21T10:05:00.000Z";
    const patch = closeGrowRequests(open, at, (request) =>
      request.kind === "ship" ? { outcome: "blocked", note: "CI red" } : null,
    );
    expect(patch.growRequests?.[1]).toMatchObject({
      closedAt: at,
      outcome: "blocked",
      note: "CI red",
    });
    expect(patch.growRequests?.[0]?.closedAt).toBeUndefined();
    // Answering again changes nothing.
    expect(
      closeGrowRequests(patch.growRequests, at, () => ({ outcome: "done" })).growRequests?.[1],
    ).toMatchObject({ outcome: "blocked" });
    expect(growRequestsUpdatedAt(patch.growRequests)).toBe(at);
    expect(growBlockedAt(patch.growRequests)).toBe(at);
    expect(growBlockedAt(open)).toBeUndefined();
  });

  it("keeps the newest requests past the cap", () => {
    let requests = openGrowRequest(undefined, open[0]!);
    for (let index = 0; index < 8; index += 1) {
      requests = openGrowRequest(requests, { ...open[1]!, id: `r${index}` });
    }
    expect(requests.map((request) => request.id)).toEqual(["r2", "r3", "r4", "r5", "r6", "r7"]);
  });
});
