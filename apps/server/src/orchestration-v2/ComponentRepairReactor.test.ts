import {
  type ElementManifest,
  MessageId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { componentRepairCommand } from "./ComponentRepairReactor.ts";

const THREAD_ID = ThreadId.make("repair-thread");
const RUN_ID = RunId.make("run-1");

const poll: ElementManifest = {
  tag: "t3-poll",
  description: "Pick several.",
  props: {
    type: "object",
    properties: {
      question: { type: "string" },
      options: { type: "array" },
      note: { type: "boolean" },
    },
    required: ["question", "options"],
  },
};
const components = new Map([[poll.tag, poll]]);

const BROKEN = '<t3-poll>\n{"question":"Which?","options":[],"note":"Pick two."}\n</t3-poll>';
const FIXED = '<t3-poll>\n{"question":"Which?","options":[]}\n</t3-poll>';

function run(overrides: Partial<OrchestrationV2Run> = {}): OrchestrationV2Run {
  const at = DateTime.makeUnsafe("2026-10-24T12:00:00.000Z");
  return {
    id: RUN_ID,
    threadId: THREAD_ID,
    ordinal: 1,
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
    providerThreadId: null,
    userMessageId: MessageId.make("message:1"),
    rootNodeId: null,
    activeAttemptId: null,
    status: "completed",
    requestedAt: at,
    startedAt: at,
    completedAt: at,
    checkpointId: null,
    contextHandoffId: null,
    ...overrides,
  } as OrchestrationV2Run;
}

function reply(text: string, second = 0): OrchestrationV2ConversationMessage {
  const at = DateTime.makeUnsafe(`2026-10-24T12:00:0${second}.000Z`);
  return {
    id: MessageId.make(`assistant-${second}`),
    threadId: THREAD_ID,
    runId: RUN_ID,
    nodeId: null,
    role: "assistant",
    text,
    attachments: [],
    streaming: false,
    createdAt: at,
    updatedAt: at,
    createdBy: "agent",
    creationSource: "provider",
  } as OrchestrationV2ConversationMessage;
}

const thread = (overrides: Partial<OrchestrationV2AppThread> = {}) =>
  ({
    id: THREAD_ID,
    archivedAt: null,
    deletedAt: null,
    creationSource: "web",
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: THREAD_ID },
    ...overrides,
  }) as OrchestrationV2AppThread;

const check = (
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
  overrides: { thread?: OrchestrationV2AppThread; run?: OrchestrationV2Run } = {},
) =>
  componentRepairCommand({
    thread: overrides.thread ?? thread(),
    runs: [overrides.run ?? run()],
    runId: RUN_ID,
    messages,
    components,
  });

describe("componentRepairCommand", () => {
  it("tells the agent which component broke, why, and what it wrote", () => {
    const command = check([reply(`Pick:\n\n${BROKEN}`)]);
    expect(command).toMatchObject({
      type: "message.dispatch",
      threadId: THREAD_ID,
      messageId: "component-repair:run-1",
      creationSource: "server",
    });
    const text = command?.type === "message.dispatch" ? command.text : "";
    expect(text).toContain('<t3-poll>: "note" should be boolean, got string.');
    expect(text).toContain(BROKEN);
    expect(text).toContain("elements_describe for t3-poll");
  });

  it("stays quiet when every component draws, or a later reply redrew the broken one", () => {
    expect(check([reply(FIXED)])).toBeNull();
    expect(check([reply(BROKEN, 0), reply(`Fixed:\n\n${FIXED}`, 1)])).toBeNull();
  });

  it("asks once: the run answering a repair request is not checked", () => {
    expect(
      check([reply(BROKEN)], {
        run: run({ userMessageId: MessageId.make("component-repair:run-0") }),
      }),
    ).toBeNull();
  });

  it("leaves an older run alone once a newer one ran", () => {
    const newer = run({
      id: RunId.make("run-2"),
      ordinal: 2,
      userMessageId: MessageId.make("message:2"),
    });
    expect(
      componentRepairCommand({
        thread: thread(),
        runs: [run(), newer],
        runId: RUN_ID,
        messages: [reply(BROKEN)],
        components,
      }),
    ).toBeNull();
  });

  it("skips unfinished runs, archived threads and subagents", () => {
    expect(check([reply(BROKEN)], { run: run({ status: "interrupted" }) })).toBeNull();
    expect(
      check([reply(BROKEN)], {
        thread: thread({ archivedAt: DateTime.makeUnsafe("2026-10-24T12:00:00.000Z") }),
      }),
    ).toBeNull();
    expect(
      check([reply(BROKEN)], {
        thread: thread({
          creationSource: "mcp",
          lineage: {
            parentThreadId: ThreadId.make("parent"),
            relationshipToParent: "subagent",
            rootThreadId: ThreadId.make("parent"),
          },
        }),
      }),
    ).toBeNull();
  });
});
