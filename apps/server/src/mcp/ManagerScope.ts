import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/**
 * The manager thread runs work across every project, so the thread tools that
 * normally stop at the calling thread's project reach every thread for it.
 * Every other thread keeps its per-project scope. Without a provider (tests,
 * servers without brainstorm) no thread is the manager.
 */
export class ManagerScope extends Context.Reference<{
  readonly isManagerThread: (threadId: ThreadId) => Effect.Effect<boolean>;
}>("t3/mcp/ManagerScope", {
  defaultValue: () => ({ isManagerThread: () => Effect.succeed(false) }),
}) {}
