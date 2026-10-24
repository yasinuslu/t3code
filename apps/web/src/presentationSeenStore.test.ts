import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { isPresentationUnseen, usePresentationSeenStore } from "./presentationSeenStore";

const ref = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("thread"));
const seenNow = () => usePresentationSeenStore.getState().seenByThreadKey[scopedThreadKey(ref)];
const unseen = (updatedAt: string | undefined) => isPresentationUnseen(seenNow(), updatedAt);

describe("presentation seen store", () => {
  beforeEach(() => usePresentationSeenStore.setState({ seenByThreadKey: {} }));

  it("keeps the newest look and never moves back", () => {
    const { markSeen } = usePresentationSeenStore.getState();
    markSeen(ref, "2026-10-24T10:00:00.000Z");
    markSeen(ref, "2026-10-24T09:00:00.000Z");
    expect(seenNow()).toBe("2026-10-24T10:00:00.000Z");
  });

  it("counts a never-seen or newer presentation as updated", () => {
    expect(unseen("2026-10-24T10:00:00.000Z")).toBe(true);
    usePresentationSeenStore.getState().markSeen(ref, "2026-10-24T10:00:00.000Z");
    expect(unseen("2026-10-24T10:00:00.000Z")).toBe(false);
    expect(unseen("2026-10-24T10:05:00.000Z")).toBe(true);
    expect(unseen(undefined)).toBe(false);
  });
});
