import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/**
 * A manager thread runs work across its profile's projects, so the thread
 * tools that normally stop at the calling thread's project reach those
 * projects' threads for it. Every other thread keeps its per-project scope.
 * Without a provider (tests, servers without brainstorm) no thread is a
 * manager.
 */
export class ManagerScope extends Context.Reference<{
  /** The projects a manager thread reaches; null for any other thread. */
  readonly reachableProjectIds: (threadId: ThreadId) => Effect.Effect<ReadonlySet<string> | null>;
}>("t3/mcp/ManagerScope", {
  defaultValue: () => ({ reachableProjectIds: () => Effect.succeed(null) }),
}) {}
