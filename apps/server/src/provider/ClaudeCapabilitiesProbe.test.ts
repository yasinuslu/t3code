// @effect-diagnostics nodeBuiltinImport:off - cleanup uses Node's retrying rm, which the FileSystem service does not expose.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ClaudeSettings, type ServerProvider } from "@t3tools/contracts";
import { vi } from "vite-plus/test";
import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import {
  buildClaudeCapabilitiesProbeQueryOptions,
  checkClaudeCodeProfiles,
  probeClaudeCapabilities,
  probeClaudeWorkspaceSnapshot,
} from "./ClaudeProvider.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

const decodeClaudeSettings = Schema.decodeEffect(ClaudeSettings);

it("drops strict MCP mode, and only that, next to an administrator's managed-mcp.json", () => {
  const options = buildClaudeCapabilitiesProbeQueryOptions({
    executablePath: "/usr/bin/claude",
    abortController: new AbortController(),
    environment: { HOME: "/home/user" },
    cwd: undefined,
    managedMcpConfig: true,
  });

  // Claude exits before initializing when handed --strict-mcp-config here.
  assert.equal(options.strictMcpConfig, undefined);
  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
});

it.effect("reports a deleted worktree's scan as finished, not pending", () =>
  Effect.gen(function* () {
    const snapshot = yield* probeClaudeWorkspaceSnapshot(
      yield* decodeClaudeSettings({}),
      { skills: [], slashCommands: [] } as unknown as ServerProvider,
      "/nonexistent/t3-deleted-worktree",
      { HOME: "/nonexistent/t3-home" },
    );
    assert.strictEqual(snapshot.slashCommandsPending, false);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("probes each code profile's account with that profile's config dir", () =>
  Effect.gen(function* () {
    const seen: Array<string | undefined> = [];
    const cwds: Array<string> = [];
    const accounts: Record<
      string,
      { email?: string; subscriptionType?: string; tokenSource: string }
    > = {
      "/home/dev/.claude-work": {
        email: "dev@example.com",
        subscriptionType: "max",
        tokenSource: "claude.ai",
      },
      "/home/dev/.claude-home": { tokenSource: "none" },
    };
    const profiles = yield* checkClaudeCodeProfiles(
      [
        { name: "work", root: "/home/dev/code/work", claudeConfigDir: "/home/dev/.claude-work" },
        { name: "home", root: "/home/dev/code/home", claudeConfigDir: "/home/dev/.claude-home" },
        { name: "plain", root: "/home/dev/code/plain", claudeConfigDir: undefined },
        {
          name: "broken",
          root: "/home/dev/code/broken",
          claudeConfigDir: "/home/dev/.claude-broken",
        },
      ],
      (environment, cwd) =>
        Effect.sync(() => {
          seen.push(environment.CLAUDE_CONFIG_DIR);
          cwds.push(cwd);
          const account = accounts[environment.CLAUDE_CONFIG_DIR ?? ""];
          return account
            ? {
                email: account.email,
                subscriptionType: account.subscriptionType,
                tokenSource: account.tokenSource,
                apiKeySource: undefined,
                apiProvider: "firstParty",
                slashCommands: [],
              }
            : undefined;
        }),
      { HOME: "/home/dev", CLAUDE_CONFIG_DIR: "/home/dev/.claude" },
    );

    assert.deepEqual(seen.toSorted(), [
      "/home/dev/.claude-broken",
      "/home/dev/.claude-home",
      "/home/dev/.claude-work",
    ]);
    assert.deepEqual(cwds.toSorted(), [
      "/home/dev/code/broken",
      "/home/dev/code/home",
      "/home/dev/code/work",
    ]);
    assert.deepEqual(
      profiles.map((profile) => [profile.name, profile.status, profile.auth.status]),
      [
        ["work", "ready", "authenticated"],
        ["home", "error", "unauthenticated"],
        ["plain", "warning", "unknown"],
        ["broken", "warning", "unknown"],
      ],
    );
    assert.equal(profiles[0]?.auth.email, "dev@example.com");
    assert.equal(profiles[0]?.auth.label, "Claude Max Subscription");
    assert.equal(profiles[0]?.configDir, "/home/dev/.claude-work");
    assert.equal(profiles[2]?.configDir, undefined);
  }),
);

it.effect("keeps the probe subprocess alive while gateway model discovery can finish", () =>
  Effect.gen(function* () {
    let abortSignal: AbortSignal | undefined;
    const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(({ options }) => {
      abortSignal = options?.abortController?.signal;
      return {
        initializationResult: async () => ({
          account: { email: "dev@example.com", subscriptionType: "pro", tokenSource: "oauth" },
          commands: [{ name: "review", description: "Review changes", argumentHint: "[path]" }],
          models: [{ value: "gateway/claude-relay", displayName: "Relay", description: "" }],
        }),
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
          new Promise((_, reject) => reject(new Error("usage unavailable"))),
      } as ReturnType<typeof ClaudeSdk.query>;
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
    const fileSystem = yield* FileSystem.FileSystem;
    const configDir = yield* fileSystem.makeTempDirectoryScoped();
    // Claude Code also reads these from settings.json, which is where gateway users set them.
    yield* fileSystem.writeFileString(
      `${configDir}/settings.json`,
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://gateway.example",
          CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
        },
      }),
    );
    const capabilities = yield* probeClaudeCapabilities(
      yield* decodeClaudeSettings({ binaryPath: "claude" }),
      { PATH: (yield* HostProcess.Environment).PATH, CLAUDE_CONFIG_DIR: configDir },
    );
    assert.deepEqual(
      capabilities.models?.map((model) => model.value),
      ["gateway/claude-relay"],
    );
    assert.equal(abortSignal?.aborted, false);
    yield* TestClock.adjust("3 seconds");
    assert.equal(abortSignal?.aborted, true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
