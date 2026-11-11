import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import { assert, describe, it } from "@effect/vitest";

import { claudeContextBreakdown } from "./ClaudeContextBreakdown.ts";

const usage = (
  overrides: Partial<SDKControlGetContextUsageResponse> = {},
): SDKControlGetContextUsageResponse => ({
  categories: [
    { id: "system_prompt", name: "System prompt", tokens: 3_100, color: "x", kind: "used" },
    { name: "Messages", tokens: 20_000, color: "x", kind: "used" },
    { id: "free_space", name: "Free space", tokens: 140_000, color: "x", kind: "free" },
    {
      id: "autocompact_buffer",
      name: "Autocompact buffer",
      tokens: 33_000,
      color: "x",
      kind: "buffer",
    },
    // A kind from a newer CLI.
    { name: "Future", tokens: 1, color: "x", kind: "future" as "used" },
  ],
  totalTokens: 27_000,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  percentage: 13.5,
  gridRows: [],
  model: "claude-haiku-5-5",
  memoryFiles: [
    { path: "/repo/CLAUDE.md", type: "Project", tokens: 900 },
    { path: "/home/CLAUDE.md", type: "User", tokens: 2_400 },
  ],
  mcpTools: [
    { name: "mcp__a__small", serverName: "a", tokens: 120, isLoaded: true },
    { name: "mcp__a__deferred", serverName: "a", tokens: 5_000, isLoaded: false },
    { name: "mcp__b__big", serverName: "b", tokens: 800 },
    { name: "mcp__b__empty", serverName: "b", tokens: 0 },
  ],
  agents: [{ agentType: "Explore", source: "built-in", tokens: 300 }],
  skills: {
    totalSkills: 2,
    includedSkills: 2,
    tokens: 150,
    skillFrontmatter: [{ name: "run", source: "bundled", tokens: 150 }],
  },
  autoCompactThreshold: 167_000,
  isAutoCompactEnabled: true,
  apiUsage: null,
  ...overrides,
});

describe("claudeContextBreakdown", () => {
  it("keeps categories, ranks loaded items by tokens and drops deferred or empty ones", () => {
    const breakdown = claudeContextBreakdown(usage(), "2026-11-11T10:00:00.000Z");
    assert.deepStrictEqual(
      breakdown.categories.map((category) => [category.id, category.kind, category.tokens]),
      [
        ["system_prompt", "used", 3_100],
        [null, "used", 20_000],
        ["free_space", "free", 140_000],
        ["autocompact_buffer", "buffer", 33_000],
      ],
    );
    assert.deepStrictEqual(breakdown.mcpTools, [
      { name: "mcp__b__big", detail: "b", tokens: 800 },
      { name: "mcp__a__small", detail: "a", tokens: 120 },
    ]);
    assert.deepStrictEqual(
      breakdown.memoryFiles.map((file) => file.name),
      ["/home/CLAUDE.md", "/repo/CLAUDE.md"],
    );
    assert.deepStrictEqual(breakdown.skills, [{ name: "run", detail: "bundled", tokens: 150 }]);
    assert.strictEqual(breakdown.autoCompactThreshold, 167_000);
  });

  it("omits the compaction threshold when auto-compact is off", () => {
    const breakdown = claudeContextBreakdown(
      (({ skills: _skills, ...rest }) => ({ ...rest, isAutoCompactEnabled: false }))(usage()),
      "2026-11-11T10:00:00.000Z",
    );
    assert.strictEqual(breakdown.autoCompactThreshold, undefined);
    assert.deepStrictEqual(breakdown.skills, []);
  });
});
