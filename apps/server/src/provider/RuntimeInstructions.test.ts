import { expect, it } from "@effect/vitest";

import { buildRuntimeInstructions } from "./RuntimeInstructions.ts";

it("always asks agents to keep the thread's presentation, with the status feeding it", () => {
  const instructions = buildRuntimeInstructions({ harness: "Claude Code" });
  expect(instructions).toContain("<presentation>");
  expect(instructions).toContain("thread_status_update only feeds its first page");
});
