/**
 * Experimental: seeds hand-written demo conversations as real, active threads
 * from `T3CODE_ELEMENTS_DEMO` (a directory of `*.json` files), without starting
 * any provider session. Threads are written the way AgentSessionImporter writes
 * imported ones. Idempotent: the thread id comes from the file name, and a
 * rerun only rewrites messages when the file's content changed.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerConfig } from "../config.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";

const PREFIX = "elements-demo:v1";
const DEFAULT_PROJECT_TITLE = "T3 Elements demo";
const DEFAULT_MODEL = "claude-opus-5-5";
const INSTANCE_ID = ProviderInstanceId.make("claudeAgent");

export interface DemoMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt?: string;
}
export interface DemoConversation {
  readonly title: string;
  readonly project?: string;
  readonly model?: string;
  readonly messages: ReadonlyArray<DemoMessage>;
}

export function expandHome(value: string): string {
  return value === "~" || value.startsWith("~/")
    ? NodePath.join(NodeOS.homedir(), value.slice(1))
    : value;
}

/** Stable UUID-shaped id (name-based, sha1) so ids survive restarts. */
export function stableUuid(name: string): string {
  const bytes = NodeCrypto.createHash("sha1").update(`${PREFIX}:${name}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseDemoConversation(raw: string): DemoConversation | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.title !== "string" || record.title.trim() === "") return null;
  if (!Array.isArray(record.messages) || record.messages.length === 0) return null;
  const messages: Array<DemoMessage> = [];
  for (const entry of record.messages) {
    if (typeof entry !== "object" || entry === null) return null;
    const message = entry as Record<string, unknown>;
    if (message.role !== "user" && message.role !== "assistant") return null;
    if (typeof message.text !== "string") return null;
    const createdAt = message.createdAt;
    if (createdAt !== undefined) {
      if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) return null;
    }
    messages.push({
      role: message.role,
      text: message.text,
      ...(createdAt === undefined ? {} : { createdAt: createdAt as string }),
    });
  }
  return {
    title: record.title,
    ...(typeof record.project === "string" && record.project.trim() !== ""
      ? { project: record.project.trim() }
      : {}),
    ...(typeof record.model === "string" && record.model.trim() !== ""
      ? { model: record.model.trim() }
      : {}),
    messages,
  };
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

/** Explicit createdAt wins; otherwise spread the messages over the hour before `anchorMs`. */
export function messageTimes(conversation: DemoConversation, anchorMs: number): Array<string> {
  const count = conversation.messages.length;
  const step = Math.floor((60 * 60 * 1000) / Math.max(count, 1));
  const start = anchorMs - 60 * 60 * 1000;
  return conversation.messages.map((message, index) =>
    message.createdAt === undefined
      ? new Date(start + index * step).toISOString()
      : new Date(message.createdAt).toISOString(),
  );
}

function messageEvents(input: {
  readonly threadId: ThreadId;
  readonly index: number;
  readonly message: DemoMessage;
  readonly createdAt: string;
  readonly contentHash: string;
}): ReadonlyArray<OrchestrationV2DomainEvent> {
  const suffix = String(input.index).padStart(6, "0");
  const messageId = MessageId.make(`${input.threadId}:${suffix}`);
  const at = DateTime.makeUnsafe(input.createdAt);
  const message: OrchestrationV2ConversationMessage = {
    createdBy: input.message.role === "user" ? "user" : "agent",
    creationSource: "server",
    id: messageId,
    threadId: input.threadId,
    runId: null,
    nodeId: null,
    role: input.message.role,
    text: input.message.text,
    attachments: [],
    streaming: false,
    createdAt: at,
    updatedAt: at,
  };
  const common = {
    id: TurnItemId.make(`${PREFIX}:turn-item:${input.threadId}:${suffix}`),
    threadId: input.threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: input.index + 1,
    status: "completed" as const,
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
  };
  const turnItem: OrchestrationV2TurnItem =
    input.message.role === "user"
      ? {
          ...common,
          createdBy: "user",
          creationSource: "server",
          type: "user_message",
          messageId,
          inputIntent: "turn_start",
          text: input.message.text,
          attachments: [],
        }
      : {
          ...common,
          type: "assistant_message",
          messageId,
          text: input.message.text,
          streaming: false,
        };
  // The content hash is part of the event id so an edited file is not
  // swallowed as a duplicate of the earlier write.
  const eventSuffix = `${input.threadId}:${suffix}:${input.contentHash}`;
  return [
    {
      id: EventId.make(`${PREFIX}:message:${eventSuffix}`),
      type: "message.updated",
      threadId: input.threadId,
      occurredAt: at,
      payload: message,
    },
    {
      id: EventId.make(`${PREFIX}:turn-item:${eventSuffix}`),
      type: "turn-item.updated",
      threadId: input.threadId,
      occurredAt: at,
      payload: turnItem,
    },
  ];
}

export const seedElementsDemo = Effect.gen(function* () {
  const dirValue = process.env.T3CODE_ELEMENTS_DEMO?.trim();
  if (!dirValue) return { seeded: 0, skipped: 0 };
  const dir = expandHome(dirValue);
  let names: ReadonlyArray<string>;
  try {
    names = NodeFS.readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .toSorted();
  } catch (cause) {
    yield* Effect.logWarning("Elements demo directory is not readable", { dir, cause });
    return { seeded: 0, skipped: 0 };
  }
  const config = yield* ServerConfig;
  const projects = yield* ProjectService.ProjectService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const projectIds = new Map<string, ProjectId>();
  let seeded = 0;
  let skipped = 0;

  for (const name of names) {
    const file = NodePath.join(dir, name);
    const outcome = yield* Effect.gen(function* () {
      const raw = NodeFS.readFileSync(file, "utf8");
      const conversation = parseDemoConversation(raw);
      if (conversation === null) {
        yield* Effect.logWarning("Skipping invalid elements demo file", { file });
        return false;
      }
      const contentHash = NodeCrypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
      const projectTitle = conversation.project ?? DEFAULT_PROJECT_TITLE;
      let projectId = projectIds.get(projectTitle);
      if (projectId === undefined) {
        const root = NodePath.join(
          config.baseDir,
          "elements-demo",
          ...(conversation.project === undefined ? [] : [slug(projectTitle)]),
        );
        NodeFS.mkdirSync(root, { recursive: true });
        const { project } = yield* projects.bootstrap({
          commandId: CommandId.make(`${PREFIX}:project:${stableUuid(`project:${root}`)}`),
          projectId: ProjectId.make(stableUuid(`project:${root}`)),
          title: projectTitle,
          workspaceRoot: root,
          createWorkspaceRootIfMissing: true,
        });
        projectId = project.id;
        projectIds.set(projectTitle, projectId);
      }

      const threadId = ThreadId.make(stableUuid(`thread:${NodePath.basename(name, ".json")}`));
      const times = messageTimes(conversation, NodeFS.statSync(file).mtimeMs);
      const existing = yield* Effect.option(orchestrator.getThreadRecords(threadId, ["messages"]));
      if (Option.isSome(existing)) {
        const current = existing.value.messages.toSorted((a, b) => a.id.localeCompare(b.id));
        const same =
          current.length === conversation.messages.length &&
          current.every(
            (message, index) =>
              message.text === conversation.messages[index]?.text &&
              message.role === conversation.messages[index]?.role,
          );
        if (same) return false;
      }
      const events: Array<OrchestrationV2DomainEvent> = [];
      if (Option.isNone(existing)) {
        const createdAt = DateTime.makeUnsafe(times[0]!);
        const updatedAt = DateTime.makeUnsafe(times[times.length - 1]!);
        const appThread: OrchestrationV2AppThread = {
          createdBy: "system",
          creationSource: "server",
          id: threadId,
          projectId,
          title: conversation.title,
          providerInstanceId: INSTANCE_ID,
          modelSelection: { instanceId: INSTANCE_ID, model: conversation.model ?? DEFAULT_MODEL },
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          linkedPullRequest: null,
          branchPullRequest: null,
          activeProviderThreadId: null,
          historyOrigin: "v1_import",
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt,
          updatedAt,
          archivedAt: null,
          settledOverride: "active",
          settledAt: null,
          unsettledAt: updatedAt,
          snoozedUntil: null,
          snoozedAt: null,
          pinnedAt: null,
          pinOrderKey: null,
          activeOrderKey: null,
          lastVisitedAt: null,
          deletedAt: null,
        };
        events.push({
          id: EventId.make(`${PREFIX}:thread:${threadId}:created`),
          type: "thread.created",
          threadId,
          providerInstanceId: INSTANCE_ID,
          occurredAt: createdAt,
          payload: appThread,
        });
      }
      conversation.messages.forEach((message, index) => {
        events.push(
          ...messageEvents({
            threadId,
            index,
            message,
            createdAt: times[index]!,
            contentHash,
          }),
        );
      });
      yield* eventSink.write({ events });
      return true;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not seed an elements demo thread", { file, cause }).pipe(
          Effect.as(false),
        ),
      ),
    );
    if (outcome) seeded += 1;
    else skipped += 1;
  }
  return { seeded, skipped };
});

/** Runs once at startup; never fails the server. */
export const layer = Layer.effectDiscard(
  seedElementsDemo.pipe(
    Effect.flatMap((result) => Effect.logInfo("Elements demo seeded", result)),
    Effect.catchCause((cause) => Effect.logWarning("Elements demo seeding failed", { cause })),
    Effect.forkScoped,
  ),
);
