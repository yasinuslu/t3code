import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import { ProjectId, type OrchestrationV2DomainEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { seedElementsDemo, stableUuid } from "./ElementsDemoSeeder.ts";

it.effect("seeds demo files as threads once, without duplicates", () => {
  const tmp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "elements-demo-"));
  const demoDir = NodePath.join(tmp, "demo");
  NodeFS.mkdirSync(demoDir);
  NodeFS.writeFileSync(
    NodePath.join(demoDir, "alpha.json"),
    JSON.stringify({
      title: "Alpha",
      messages: [
        { role: "user", text: "Show me a chart" },
        { role: "assistant", text: "Here it is" },
      ],
    }),
  );
  NodeFS.writeFileSync(
    NodePath.join(demoDir, "beta.json"),
    JSON.stringify({
      title: "Beta",
      project: "Other",
      messages: [{ role: "user", text: "Hi", createdAt: "2026-10-01T10:00:00.000Z" }],
    }),
  );
  NodeFS.writeFileSync(NodePath.join(demoDir, "bad.json"), "{not json");
  process.env.T3CODE_ELEMENTS_DEMO = demoDir;

  const writes: Array<ReadonlyArray<OrchestrationV2DomainEvent>> = [];
  const known = new Map<string, Array<{ id: string; role: string; text: string }>>();
  const layer = Layer.mergeAll(
    Layer.succeed(ServerConfig, { baseDir: tmp } as never),
    Layer.mock(ProjectService.ProjectService)({
      bootstrap: (input) =>
        Effect.succeed({
          created: true,
          project: { id: ProjectId.make(input.projectId), title: input.title } as never,
        }),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadRecords: (threadId: string) => {
        const messages = known.get(threadId);
        return messages === undefined
          ? Effect.fail(
              new Orchestrator.OrchestratorProjectionError({ threadId: threadId as never }),
            )
          : Effect.succeed({ thread: { id: threadId }, messages } as never);
      },
    }),
    Layer.mock(EventSink.EventSinkV2)({
      write: (input) =>
        Effect.sync(() => {
          writes.push(input.events);
          for (const event of input.events) {
            if (event.type === "message.updated") {
              const list = known.get(event.threadId) ?? [];
              list.push({
                id: event.payload.id,
                role: event.payload.role,
                text: event.payload.text,
              });
              known.set(event.threadId, list);
            }
          }
          return [];
        }),
    }),
  );

  return Effect.gen(function* () {
    expect(yield* seedElementsDemo).toEqual({ seeded: 2, skipped: 1 });
    expect(yield* seedElementsDemo).toEqual({ seeded: 0, skipped: 3 });

    expect(writes).toHaveLength(2);
    const alpha = writes[0]!;
    expect(alpha.map((event) => event.type)).toEqual([
      "thread.created",
      "message.updated",
      "turn-item.updated",
      "message.updated",
      "turn-item.updated",
    ]);
    expect(alpha[0]?.threadId).toBe(stableUuid("thread:alpha"));
    const alphaMessages = alpha.filter((event) => event.type === "message.updated");
    expect(alphaMessages.map((event) => [event.payload.role, event.payload.text])).toEqual([
      ["user", "Show me a chart"],
      ["assistant", "Here it is"],
    ]);
    expect(
      alpha
        .filter((event) => event.type === "turn-item.updated")
        .map((event) => event.payload.ordinal),
    ).toEqual([1, 2]);
    expect(alphaMessages[0]!.payload.createdAt < alphaMessages[1]!.payload.createdAt).toBe(true);
    expect(NodeFS.existsSync(NodePath.join(tmp, "elements-demo"))).toBe(true);
    expect(NodeFS.existsSync(NodePath.join(tmp, "elements-demo", "other"))).toBe(true);
  }).pipe(
    Effect.provide(layer),
    Effect.ensuring(
      Effect.sync(() => {
        delete process.env.T3CODE_ELEMENTS_DEMO;
        NodeFS.rmSync(tmp, { recursive: true, force: true });
      }),
    ),
  );
});
