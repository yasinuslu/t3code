import { expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import {
  EnvironmentId,
  OrchestratorMcpFailure,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import * as ForkFeatures from "../forkFeatures.ts";
import * as ServerSettings from "../serverSettings.ts";
import { gateToolkit } from "./ForkMcpToolkits.ts";
import * as McpHttpServer from "./McpHttpServer.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as McpToolAccess from "./McpToolAccess.ts";
import * as McpToolAccessTestkit from "./McpToolAccess.testkit.ts";

const ProbeToolkit = Toolkit.make(
  Tool.make("probe_read", {
    description: "Reads the probe.",
    success: Schema.Struct({ value: Schema.Number }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
  }),
  Tool.make("probe_linked", {
    description: "Only while links are on.",
    success: Schema.Struct({ value: Schema.Number }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
  }).annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenWhileLinksOff),
);

const environmentId = EnvironmentId.make("environment-fork-mcp-test");
const token = "forkToken";
const scope: McpInvocationContext.McpThreadInvocationScope = {
  environmentId,
  requestNamespace: token,
  thread: {
    threadId: ThreadId.make("thread-fork"),
    providerSessionId: token,
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

it.effect("mirrors the flags the settings hold when the layer starts", () =>
  Effect.gen(function* () {
    const previous = ForkFeatures.setForkFeaturesForTest({});
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => ForkFeatures.setForkFeaturesForTest(previous)),
    );
    yield* Layer.build(
      ForkFeatures.layer.pipe(
        Layer.provide(ServerSettings.layerTest({ forkFeatures: { presentation: false } })),
      ),
    );
    expect(ForkFeatures.forkFeatureOn("presentation")).toBe(false);
    expect(ForkFeatures.forkFeatureOn("manager")).toBe(true);
  }).pipe(Effect.scoped),
);

it.effect("lists and runs a gated toolkit only while its fork feature is on", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const settingsContext = yield* Layer.build(ServerSettings.layerTest());
      const settings = Context.get(settingsContext, ServerSettings.ServerSettingsService);
      const serverLayer = Layer.mergeAll(
        McpHttpServer.toolkitRegistration(
          gateToolkit("presentation", ProbeToolkit),
          McpToolAccess.toLayer(ProbeToolkit, {
            probe_read: McpToolAccess.reads(() => Effect.succeed({ value: 1 })),
            probe_linked: McpToolAccess.reads(() => Effect.succeed({ value: 2 })),
          }),
        ),
        ForkFeatures.layer,
      ).pipe(
        Layer.provideMerge(McpHttpServer.layerMcpTransport),
        Layer.provide(Layer.succeedContext(settingsContext)),
        Layer.provide(McpToolAccessTestkit.liveThreadsLayer),
        Layer.provide(
          Layer.mock(McpSessionRegistry.McpSessionRegistry)({
            resolve: (presented) => Effect.succeed(presented === token ? scope : undefined),
          }),
        ),
      );
      yield* HttpRouter.serve(serverLayer, { disableListenLog: true, disableLogger: true }).pipe(
        Layer.build,
      );
      const httpClient = yield* HttpClient.HttpClient;
      const headers = {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      };
      const initialize = yield* httpClient.post("/mcp", {
        headers,
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}`,
          "application/json",
        ),
      });
      const rpc = (method: string, params: object) =>
        httpClient
          .post("/mcp", {
            headers: {
              ...headers,
              "mcp-session-id": initialize.headers["mcp-session-id"]!,
              "mcp-protocol-version": "2025-06-18",
            },
            body: HttpBody.text(
              JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }),
              "application/json",
            ),
          })
          .pipe(Effect.flatMap((response) => response.json));
      const listed = rpc("tools/list", {}).pipe(
        Effect.map((body) =>
          (body as { result: { tools: ReadonlyArray<{ name: string }> } }).result.tools
            .map((tool) => tool.name)
            .toSorted(),
        ),
      );
      const read = rpc("tools/call", { name: "probe_read", arguments: {} });

      // The tool's own visibility still applies: links are off in these settings.
      expect(yield* listed).toEqual(["probe_read"]);
      expect(yield* read).toMatchObject({ result: { structuredContent: { value: 1 } } });

      // Settings changes reach the mirror through the live settings stream, which the test
      // settings lack, so the switch is flipped there directly.
      const previous = ForkFeatures.setForkFeaturesForTest({ presentation: false });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => ForkFeatures.setForkFeaturesForTest(previous)),
      );
      expect(yield* listed).toEqual([]);
      expect(yield* read).not.toHaveProperty("result.structuredContent");

      ForkFeatures.setForkFeaturesForTest({ presentation: true });
      yield* settings.updateSettings({ linkedEnvironmentsEnabled: true });
      expect(yield* listed).toEqual(["probe_linked", "probe_read"]);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
