import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AccountBalancer from "./AccountBalancer.ts";
import { CodeProfiles } from "./CodeProfiles.ts";
import { makeProviderRegistryLayer } from "./testUtils/providerRegistryMock.ts";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const HOUR = 3_600_000;
const first = ProviderInstanceId.make("claude");
const second = ProviderInstanceId.make("claude_2");
const profileProject = ProjectId.make("project:in-profile");
const otherProject = ProjectId.make("project:outside");
const selection = { instanceId: first, model: "claude-opus-5-5" };

function provider(instanceId: ProviderInstanceId, usedPercent: number): ServerProvider {
  return {
    instanceId,
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: instanceId === first ? "Claude" : "Claude 2",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-13T11:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt: "2026-10-13T11:59:00.000Z",
      windows: [
        {
          id: "five_hour",
          kind: "session",
          label: "Session",
          usedPercent,
          resetsAt: "2026-10-13T15:00:00.000Z",
        },
      ],
    },
  };
}

/** One server state directory, so a rebuilt balancer reads what the last one saved. */
function dependencies(usedPercent: { readonly first: number; readonly second: number }) {
  return Layer.mergeAll(
    ServerSettings.layerTest({
      codeProfiles: {
        yu: {
          root: "/code/yu",
          accountBalancing: {
            enabled: true,
            accounts: [{ instanceId: first }, { instanceId: second }],
          },
        },
      },
    }),
    makeProviderRegistryLayer([
      provider(first, usedPercent.first),
      provider(second, usedPercent.second),
    ]),
    Layer.mock(CodeProfiles)({
      resolve: (folder) =>
        Effect.succeed(
          folder.startsWith("/code/yu") ? { name: "yu", claudeConfigDir: undefined } : undefined,
        ),
    }),
    Layer.mock(ProjectService.ProjectService)({
      getById: (id) =>
        Effect.succeedSome({
          id,
          workspaceRoot: id === profileProject ? "/code/yu/app" : "/elsewhere/app",
        } as Option.Option.Value<
          Effect.Success<ReturnType<ProjectService.ProjectService["Service"]["getById"]>>
        >),
    }),
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-account-balancer-" }),
  ).pipe(Layer.provideMerge(NodeServices.layer));
}

const withBalancer = <A, E>(
  use: (balancer: AccountBalancer.AccountBalancer["Service"]) => Effect.Effect<A, E>,
) =>
  AccountBalancer.AccountBalancer.pipe(Effect.flatMap(use), Effect.provide(AccountBalancer.layer));

it.effect("starts a thread on the account with more quota left only when asked to balance", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const choose = (projectId: ProjectId, mode: "auto" | "pinned") =>
      withBalancer((balancer) => balancer.chooseForLaunch({ projectId, selection, mode }));

    assert.deepEqual(yield* choose(profileProject, "auto"), {
      modelSelection: { instanceId: second, model: "claude-opus-5-5" },
    });
    assert.deepEqual(yield* choose(profileProject, "pinned"), { modelSelection: selection });
    assert.deepEqual(yield* choose(otherProject, "auto"), { modelSelection: selection });
  }).pipe(Effect.provide(dependencies({ first: 80, second: 10 }))),
);

it.effect("replaces a limited account even when the launch names it", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const choice = yield* withBalancer((balancer) =>
      balancer.chooseForLaunch({ projectId: profileProject, selection, mode: "pinned" }),
    );
    assert.deepEqual(choice, {
      modelSelection: { instanceId: second, model: "claude-opus-5-5" },
      replaced: { from: "Claude", to: "Claude 2", limitedFor: 3 * HOUR },
    });
  }).pipe(Effect.provide(dependencies({ first: 100, second: 10 }))),
);

it.effect("remembers a limit a turn hit across restarts, until a later turn gets through", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const choose = withBalancer((balancer) =>
      balancer.chooseForLaunch({ projectId: profileProject, selection, mode: "pinned" }),
    );
    yield* withBalancer((balancer) =>
      balancer.recordLimit(first, DateTime.formatIso(DateTime.makeUnsafe(NOW + 22 * HOUR))),
    );

    // A new balancer stands in for the server after a restart.
    assert.deepEqual((yield* choose).replaced, {
      from: "Claude",
      to: "Claude 2",
      limitedFor: 22 * HOUR,
    });

    // A turn that started before the limit was seen proves nothing about it.
    yield* withBalancer((balancer) => balancer.clearLimit(first, NOW - 1));
    assert.equal((yield* choose).modelSelection.instanceId, second);

    yield* withBalancer((balancer) => balancer.clearLimit(first, NOW + 1));
    assert.deepEqual(yield* choose, { modelSelection: selection });
  }).pipe(Effect.provide(dependencies({ first: 20, second: 10 }))),
);
