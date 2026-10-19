import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * A sandbox runs threads, not folders. A thread chooses its workspace (the
 * project checkout, a new worktree, or an existing one) and, separately,
 * whether it runs in a sandbox. Sandboxed threads in the same workspace share
 * one sandbox (a microVM or a container) that mounts the workspace at its
 * own path; their agents, terminals, and setup script run inside it, while
 * other threads in that workspace stay on the host. Clients match a thread
 * to its sandbox by thread id.
 */
/** The runtime a sandbox runs on: a microsandbox microVM or a Docker container. */
export const SandboxBackendKind = Schema.Literals(["microsandbox", "docker"]);
export type SandboxBackendKind = typeof SandboxBackendKind.Type;

/** `sleeping`: idle and frozen, its processes intact; any use wakes it. */
export const SandboxStatus = Schema.Literals([
  "starting",
  "running",
  "sleeping",
  "stopped",
  "error",
]);
export type SandboxStatus = typeof SandboxStatus.Type;

const PortNumber = Schema.Int.check(Schema.isGreaterThan(0)).check(Schema.isLessThan(65536));

/** A port an app listens on inside the sandbox, forwarded to the server host's loopback. */
export const SandboxPort = Schema.Struct({
  containerPort: PortNumber,
  hostPort: PortNumber,
});
export type SandboxPort = typeof SandboxPort.Type;

export const SandboxSummary = Schema.Struct({
  /** The folder the sandbox mounts: a project checkout or a worktree. */
  workspacePath: TrimmedNonEmptyString,
  /** The threads that run in this sandbox. */
  threadIds: Schema.Array(ThreadId),
  containerName: TrimmedNonEmptyString,
  /** Missing from servers that only ran Docker sandboxes. */
  backend: Schema.optionalKey(SandboxBackendKind),
  image: TrimmedNonEmptyString,
  status: SandboxStatus,
  ports: Schema.Array(SandboxPort),
  /** Human readable reason when status is error. */
  error: Schema.NullOr(Schema.String),
});
export type SandboxSummary = typeof SandboxSummary.Type;

/** The full sandbox list. Sent first, then after every change. */
export const SandboxListStreamEvent = Schema.Struct({
  sandboxes: Schema.Array(SandboxSummary),
});
export type SandboxListStreamEvent = typeof SandboxListStreamEvent.Type;

export const SandboxThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type SandboxThreadInput = typeof SandboxThreadInput.Type;

export class SandboxRequestError extends Schema.TaggedError<SandboxRequestError>()(
  "SandboxRequestError",
  {
    operation: Schema.Literals(["enable", "stop", "disable"]),
    threadId: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    const action =
      this.operation === "enable"
        ? "move this thread into a sandbox"
        : this.operation === "stop"
          ? "stop the sandbox"
          : "take this thread out of its sandbox";
    return `Could not ${action}: ${this.detail}`;
  }
}
