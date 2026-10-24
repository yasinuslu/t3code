import { expect, it } from "@effect/vitest";

import { buildRuntimeInstructions } from "./RuntimeInstructions.ts";

it("always asks agents to keep the thread's presentation, next to the status card", () => {
  const instructions = buildRuntimeInstructions({ harness: "Claude Code" });
  expect(instructions).toContain("<presentation>");
  expect(instructions).toContain("thread_status_update its short card");
});
