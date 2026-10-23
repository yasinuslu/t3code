import { afterEach, expect, it } from "@effect/vitest";

import {
  buildRuntimeInstructions,
  setPresentationInstructionsEnabled,
} from "./RuntimeInstructions.ts";

afterEach(() => setPresentationInstructionsEnabled(false));

it("asks for a presentation only while the experimental presentation is on", () => {
  expect(buildRuntimeInstructions({ harness: "Claude Code" })).not.toContain("<presentation>");
  setPresentationInstructionsEnabled(true);
  expect(buildRuntimeInstructions({ harness: "Claude Code" })).toContain("<presentation>");
  setPresentationInstructionsEnabled(false);
  expect(buildRuntimeInstructions({ harness: "Claude Code" })).not.toContain("<presentation>");
});
