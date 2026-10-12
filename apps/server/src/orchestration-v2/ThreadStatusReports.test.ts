import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  type OrchestrationV2ServerCommand,
  type ThreadStatusReport,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import { resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ThreadStatusReports from "./ThreadStatusReports.ts";

const THREAD_ID = ThreadId.make("thread-status");

// The orchestrator applies `thread.status-report.set` for real in its own tests;
// here it only records the command and keeps the report the service reads back.
const makeLayer = Effect.gen(function* () {
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationV2ServerCommand>>([]);
  const report = yield* Ref.make<ThreadStatusReport | undefined>(undefined);
  const layer = ThreadStatusReports.layer.pipe(
    Layer.provide(
      Layer.mock(Orchestrator.OrchestratorV2)({
        getThreadRecords: () =>
          // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off - the service reads only the report.
          Ref.get(report).pipe(
            Effect.map((statusReport) => ({ thread: { statusReport } }) as never),
          ),
        dispatch: (command) =>
          Effect.gen(function* () {
            yield* Ref.update(commands, (recorded) => [...recorded, command]);
            if (command.type === "thread.status-report.set") {
              yield* Ref.set(report, { text: command.text, updatedAt: "2026-10-12T00:00:00.000Z" });
            }
            return { sequence: 1, storedEvents: [] };
          }),
      }),
    ),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-status-report-" })),
    Layer.provideMerge(NodeCrypto.layer),
    Layer.provideMerge(NodeServices.layer),
  );
  return { commands, layer };
});

const lastText = (commands: ReadonlyArray<OrchestrationV2ServerCommand>) => {
  const command = commands.at(-1);
  return command?.type === "thread.status-report.set" ? command.text : undefined;
};

describe("ThreadStatusReports", () => {
  it.effect("stores local screenshots once and drops the ones a new report no longer shows", () =>
    Effect.gen(function* () {
      const { commands, layer } = yield* makeLayer;
      yield* Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig.ServerConfig;
        const reports = yield* ThreadStatusReports.ThreadStatusReports;
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-shots-" });
        const before = path.join(directory, "before.png");
        const copy = path.join(directory, "same bytes.png");
        const after = path.join(directory, "after.jpeg");
        yield* fileSystem.writeFile(before, new Uint8Array([1, 2, 3]));
        yield* fileSystem.writeFile(copy, new Uint8Array([1, 2, 3]));
        yield* fileSystem.writeFile(after, new Uint8Array([4, 5, 6]));

        const first = yield* reports.set({
          threadId: THREAD_ID,
          report: `Done.\n\n![Before](${before}) ![Copy](<${copy}>)\n\n![Site](https://example.org/a.png)`,
          readLocalImages: true,
        });
        expect(first.storedImages).toBe(1);
        const firstText = lastText(yield* Ref.get(commands))!;
        const [beforeId, copyId] = [...firstText.matchAll(/attachment:([\w-]+)/g)].map(
          (match) => match[1]!,
        );
        // Same bytes, same attachment.
        expect(beforeId).toBe(copyId);
        expect(firstText).toContain("![Site](https://example.org/a.png)");
        expect(firstText).not.toContain(directory);
        const beforeFile = resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: beforeId!,
        });
        expect(beforeFile).not.toBeNull();

        // The worktree's copy can go away; the stored one stays.
        yield* fileSystem.remove(before);
        yield* reports.set({
          threadId: THREAD_ID,
          report: `Updated.\n\n![After](${after})`,
          readLocalImages: true,
        });
        expect(lastText(yield* Ref.get(commands))).toMatch(/^Updated\.\n\n!\[After\]\(attachment:/);
        expect(yield* fileSystem.exists(beforeFile!)).toBe(false);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("refuses local screenshots it may not read, and unreadable ones", () =>
    Effect.gen(function* () {
      const { commands, layer } = yield* makeLayer;
      yield* Effect.gen(function* () {
        const reports = yield* ThreadStatusReports.ThreadStatusReports;
        const refused = yield* reports
          .set({ threadId: THREAD_ID, report: "![shot](/tmp/shot.png)", readLocalImages: false })
          .pipe(Effect.flip);
        expect(refused._tag).toBe("ThreadStatusReportLocalImagesRefusedError");
        const missing = yield* reports
          .set({
            threadId: THREAD_ID,
            report: "![shot](/nonexistent/t3-status/shot.png)",
            readLocalImages: true,
          })
          .pipe(Effect.flip);
        expect(missing._tag).toBe("ThreadStatusReportImageUnreadableError");
        expect(yield* Ref.get(commands)).toEqual([]);
      }).pipe(Effect.provide(layer));
    }),
  );
});
