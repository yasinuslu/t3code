import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type {
  ContextBreakdown,
  ContextBreakdownCategoryKind,
  ContextBreakdownItem,
} from "@t3tools/contracts";

const KNOWN_KINDS: ReadonlySet<string> = new Set<ContextBreakdownCategoryKind>([
  "used",
  "free",
  "buffer",
  "deferred",
]);

// Bounds the payload for sessions with hundreds of MCP tools; the panel shows only the top rows.
const MAX_ITEMS = 50;

function topItems(items: ReadonlyArray<ContextBreakdownItem>): Array<ContextBreakdownItem> {
  return items
    .filter((item) => item.tokens > 0)
    .toSorted((left, right) => right.tokens - left.tokens)
    .slice(0, MAX_ITEMS);
}

/** Maps Claude's `/context` data to the provider-neutral breakdown; deferred tool schemas are kept but marked. */
export function claudeContextBreakdown(
  usage: SDKControlGetContextUsageResponse,
  fetchedAt: string,
): ContextBreakdown {
  return {
    model: usage.model,
    totalTokens: usage.totalTokens,
    maxTokens: usage.maxTokens,
    ...(usage.isAutoCompactEnabled && usage.autoCompactThreshold !== undefined
      ? { autoCompactThreshold: usage.autoCompactThreshold }
      : {}),
    // A later CLI may add kinds; dropping that row beats failing to encode the whole reply.
    categories: usage.categories
      .filter((category) => KNOWN_KINDS.has(category.kind))
      .map((category) => ({
        id: category.id ?? null,
        name: category.name,
        tokens: category.tokens,
        kind: category.kind,
      })),
    mcpTools: topItems(
      usage.mcpTools
        // Deferred MCP tools cost nothing until loaded, so they would mislead a "what fills it" list.
        .filter((tool) => tool.isLoaded !== false)
        .map((tool) => ({ name: tool.name, detail: tool.serverName, tokens: tool.tokens })),
    ),
    memoryFiles: topItems(
      usage.memoryFiles.map((file) => ({
        name: file.path,
        detail: file.type,
        tokens: file.tokens,
      })),
    ),
    skills: topItems(
      (usage.skills?.skillFrontmatter ?? []).map((skill) => ({
        name: skill.name,
        detail: skill.source,
        tokens: skill.tokens,
      })),
    ),
    agents: topItems(
      usage.agents.map((agent) => ({
        name: agent.agentType,
        detail: agent.source,
        tokens: agent.tokens,
      })),
    ),
    fetchedAt,
  };
}
