import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  type ProviderAuthState,
  type ServerSettings as ServerSettingsValue,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as References from "effect/References";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import type * as PtyAdapter from "../terminal/PtyAdapter.ts";
import { makeClaudeProfileLoginAuth } from "./ClaudeProfileLoginAuth.ts";
import {
  ClaudeProfileLogins,
  claudeProfileEnvironment,
  findClaudeLoginToken,
  layer as claudeProfileLoginsLayer,
  redactClaudeLoginTokens,
} from "./ClaudeProfileLogins.ts";

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const TOKEN = `sk-ant-oat01-${"A1b2_C3d4-".repeat(9)}`;
const INHERITED = `sk-ant-oat01-${"inherited0".repeat(4)}`;
const instanceId = ProviderInstanceId.make("claudeAgent");
const workProfile = {
  root: "/home/dev/code/work",
  claude: { configDir: "/home/dev/code/work/.claude", extraConfigDirs: [] },
};

describe("claudeProfileEnvironment", () => {
  const base = { HOME: "/home/dev", CLAUDE_CODE_OAUTH_TOKEN: INHERITED };

  it("leaves an inherited token alone outside a code profile", () => {
    const env = claudeProfileEnvironment(base, { configDir: "/dir", profiled: false });
    assert.strictEqual(env.CLAUDE_CODE_OAUTH_TOKEN, INHERITED);
    assert.strictEqual(env.CLAUDE_CONFIG_DIR, "/dir");
  });

  it("drops an inherited token for the profile's home login", () => {
    const env = claudeProfileEnvironment(base, { configDir: "/dir", profiled: true });
    assert.isFalse("CLAUDE_CODE_OAUTH_TOKEN" in env);
    assert.strictEqual(env.CLAUDE_CONFIG_DIR, "/dir");
    assert.strictEqual(env.HOME, "/home/dev");
  });

  it("gives the profile's token login precedence over an inherited token", () => {
    const env = claudeProfileEnvironment(base, { configDir: "/dir", profiled: true, token: TOKEN });
    assert.strictEqual(env.CLAUDE_CODE_OAUTH_TOKEN, TOKEN);
    // The home dir stays, so settings, plugins and history are unchanged.
    assert.strictEqual(env.CLAUDE_CONFIG_DIR, "/dir");
  });
});

describe("setup-token output", () => {
  it("finds the printed token through terminal escapes and redacts it", () => {
    const output = `Your token:\r\n\u001b[1m${TOKEN}\u001b[22m\r\nUse this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>\r\n`;
    assert.strictEqual(findClaudeLoginToken(output), TOKEN);
    assert.notInclude(redactClaudeLoginTokens(output), TOKEN);
    assert.isUndefined(findClaudeLoginToken("no token here"));
  });
});

/** In-memory secrets, settings with one profile, and every log line. */
const harness = Effect.gen(function* () {
  const secrets = new Map<string, Uint8Array>();
  const logs: string[] = [];
  const secretStore = ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.sync(() => Option.fromUndefinedOr(secrets.get(name))),
    set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
    remove: (name) => Effect.sync(() => void secrets.delete(name)),
    create: () => Effect.die("unused"),
    getOrCreateRandom: () => Effect.die("unused"),
  });
  const logger = Logger.make(({ fiber, message }) => {
    logs.push(toJson([message, fiber.getRef(References.CurrentLogAnnotations)]));
  });
  // The test settings service does not stream changes; publish each update.
  const settingsLayer = Layer.effect(
    ServerSettings.ServerSettingsService,
    Effect.gen(function* () {
      const base = yield* ServerSettings.ServerSettingsService;
      const changes = yield* PubSub.unbounded<ServerSettingsValue>();
      return ServerSettings.ServerSettingsService.of({
        ...base,
        updateSettings: (patch) =>
          base.updateSettings(patch).pipe(Effect.tap((next) => PubSub.publish(changes, next))),
        streamChanges: Stream.fromPubSub(changes),
        subscribeChanges: PubSub.subscribe(changes).pipe(Effect.map(Stream.fromSubscription)),
      });
    }),
  ).pipe(Layer.provide(ServerSettings.layerTest({ codeProfiles: { work: workProfile } })));
  const layer = claudeProfileLoginsLayer.pipe(
    Layer.provideMerge(settingsLayer),
    Layer.provide(Layer.succeed(ServerSecretStore.ServerSecretStore, secretStore)),
    Layer.provideMerge(Logger.layer([logger], { mergeWithExisting: false })),
    Layer.provideMerge(NodeServices.layer),
  );
  return { secrets, logs, layer };
});

const fakePty = (chunks: ReadonlyArray<string>, written: string[]) =>
  ({
    spawn: () =>
      Effect.sync(() => {
        let onData: (data: string) => void = () => {};
        let onExit: (event: PtyAdapter.PtyExitEvent) => void = () => {};
        const process: PtyAdapter.PtyProcess = {
          pid: 1,
          write: (data) => {
            written.push(data);
            // The CLI prints the token once the user finishes in the browser.
            queueMicrotask(() => {
              for (const chunk of chunks) onData(chunk);
              onExit({ exitCode: 0, signal: null });
            });
          },
          resize: () => {},
          kill: () => {},
          onData: (callback) => {
            onData = callback;
            return () => {};
          },
          onExit: (callback) => {
            onExit = callback;
            return () => {};
          },
        };
        return process;
      }),
  }) satisfies PtyAdapter.PtyAdapter["Service"];

const waitFor = (
  states: Stream.Stream<ProviderAuthState>,
  predicate: (state: ProviderAuthState) => boolean,
) => states.pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow));

describe("adding a token login", () => {
  it.effect.each([
    { method: "paste-token:work", pasted: true },
    { method: "setup-token:work", pasted: false },
  ])("$method stores the token in the secret store only", ({ method, pasted }) =>
    Effect.gen(function* () {
      const { secrets, logs, layer } = yield* harness;
      yield* Effect.gen(function* () {
        const settings = yield* ServerSettings.ServerSettingsService;
        const logins = yield* ClaudeProfileLogins;
        const written: string[] = [];
        const auth = yield* makeClaudeProfileLoginAuth({
          instanceId,
          settings,
          logins,
          // The token arrives split across chunks, as a PTY delivers it.
          pty: Option.some(
            fakePty(["Token:\r\n", TOKEN.slice(0, 30), `${TOKEN.slice(30)}\r\n`], written),
          ),
          setupTokenCommand: { command: "claude", args: ["setup-token"] },
          environment: {},
          cwd: "/",
        });
        const seen: ProviderAuthState[] = [];
        yield* auth.subscribe("owner").pipe(
          Stream.runForEach((state) => Effect.sync(() => void seen.push(state))),
          Effect.forkScoped,
        );
        const started = yield* auth.start("owner", Effect.die("must not stop sessions"), method);
        const asking = yield* waitFor(
          auth.subscribe("owner"),
          (state) => state.interaction?.type === "credentials",
        );
        yield* auth.respond!("owner", {
          instanceId,
          flowId: started.flowId!,
          interactionId: asking.interaction!.id,
          response: {
            type: "credentials",
            values: pasted ? { name: "Billing", token: ` ${TOKEN} ` } : { name: "Billing" },
          },
        });
        if (!pasted) {
          const terminal = yield* waitFor(
            auth.subscribe("owner"),
            (state) => state.interaction?.type === "terminal",
          );
          yield* auth.respond!("owner", {
            instanceId,
            flowId: started.flowId!,
            interactionId: terminal.interaction!.id,
            response: { type: "terminal", data: "\r" },
          });
          assert.deepStrictEqual(written, ["\r"]);
        }
        const done = yield* waitFor(
          auth.subscribe("owner"),
          (state) => state.phase === "succeeded" || state.phase === "failed",
        );
        assert.deepStrictEqual([done.phase, done.message], ["succeeded", "Sign-in complete."]);

        const saved = (yield* settings.getSettings).codeProfiles.work?.claude?.logins ?? [];
        assert.strictEqual(saved.length, 1);
        assert.strictEqual(saved[0]?.name, "Billing");
        assert.strictEqual(
          Option.getOrThrow(yield* logins.read(saved[0]!.id)).token,
          TOKEN,
          "the secret store holds the token",
        );
        assert.notInclude(toJson(yield* settings.getSettings), TOKEN);
        assert.notInclude(toJson(seen), TOKEN.slice(13, 40));
      }).pipe(Effect.provide(layer));
      assert.strictEqual(secrets.size, 1);
      assert.notInclude(logs.join("\n"), TOKEN.slice(13, 40));
    }).pipe(Effect.scoped),
  );

  it.effect("removes a login's token when the login leaves settings", () =>
    Effect.gen(function* () {
      const { secrets, layer } = yield* harness;
      yield* Effect.gen(function* () {
        const settings = yield* ServerSettings.ServerSettingsService;
        const logins = yield* ClaudeProfileLogins;
        const { id } = yield* logins.save(TOKEN);
        yield* settings.updateSettings({
          codeProfiles: {
            work: {
              ...workProfile,
              claude: { ...workProfile.claude, logins: [{ id, name: "A" }] },
            },
          },
        });
        assert.strictEqual(secrets.size, 1);
        yield* settings.updateSettings({ codeProfiles: { work: workProfile } });
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        assert.strictEqual(secrets.size, 0);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped),
  );
});
