import { describe, expect, it } from "vite-plus/test";

import { type GrowStageFacts, growStageOf } from "./grow.ts";

const facts = (overrides: Partial<GrowStageFacts> = {}): GrowStageFacts => ({
  hasPlayable: false,
  working: false,
  merged: false,
  settled: false,
  ...overrides,
});

describe("growStageOf", () => {
  it.each([
    ["nothing known", undefined, facts(), "exploring"],
    ["a playable that is idle", undefined, facts({ hasPlayable: true }), "play"],
    [
      "a playable still being worked on",
      undefined,
      facts({ hasPlayable: true, working: true }),
      "exploring",
    ],
    ["settled", undefined, facts({ settled: true }), "done"],
    ["adopted", { decision: "adopt" as const }, facts({ hasPlayable: true }), "building"],
    ["a stored stage", { stage: "regroup" as const }, facts({ hasPlayable: true }), "regroup"],
    ["merged beats a stored stage", { stage: "play" as const }, facts({ merged: true }), "done"],
    ["shelved beats merged", { stage: "shelved" as const }, facts({ merged: true }), "shelved"],
    [
      "a stored stage beats adopt",
      { stage: "idea" as const, decision: "adopt" as const },
      facts(),
      "idea",
    ],
  ])("%s", (_name, card, given, expected) => {
    expect(growStageOf(card, given)).toBe(expected);
  });
});
