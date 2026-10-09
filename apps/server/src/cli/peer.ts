/**
 * `t3 peer` - provision the other T3 servers this server's manager can reach.
 *
 * A peer is stored once, with a bearer token issued on that peer, in this
 * server's secret store; `--base-dir` selects the same store the server reads.
 */
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as PeerEnvironments from "../peers/PeerEnvironments.ts";
import { authLocationFlags, type CliAuthLocationFlags, resolveCliAuthConfig } from "./config.ts";

class PeerCliInputError extends Schema.TaggedError<PeerCliInputError>()("PeerCliInputError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

const runWithPeers = <A, E>(
  flags: CliAuthLocationFlags,
  run: (peers: PeerEnvironments.PeerEnvironments["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
    return yield* Effect.gen(function* () {
      return yield* run(yield* PeerEnvironments.PeerEnvironments);
    }).pipe(
      Effect.provide(
        PeerEnvironments.layer.pipe(
          Layer.provide(ServerSecretStore.layer),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(ServerConfig.layer(config)),
          Layer.provide(Layer.succeed(References.MinimumLogLevel, "Error")),
        ),
      ),
    );
  });

const readTokenFromStdin = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio;
  const text = yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString);
  const token = text.trim();
  if (token === "") return yield* new PeerCliInputError({ detail: "No token on stdin." });
  return token;
});

const addCommand = Command.make("add", {
  ...authLocationFlags,
  name: Flag.String("name").pipe(Flag.withDescription("Short name the manager uses for the peer.")),
  url: Flag.String("url").pipe(
    Flag.withDescription("The peer's HTTP base URL, for example http://host:3773."),
  ),
  tokenStdin: Flag.Boolean("token-stdin").pipe(
    Flag.withDescription(
      "Read the peer's bearer token (from `t3 auth session issue --token-only` on the peer) from stdin.",
    ),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Add or replace a peer T3 server after checking it answers."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      if (!flags.tokenStdin) {
        return yield* new PeerCliInputError({
          detail: "Pass --token-stdin and pipe the token in.",
        });
      }
      const token = yield* readTokenFromStdin;
      const name = flags.name.trim();
      if (name === "") return yield* new PeerCliInputError({ detail: "--name must not be empty." });
      yield* runWithPeers(flags, (peers) =>
        Effect.gen(function* () {
          const peer = { name, url: flags.url, token };
          const { descriptor, threadCount } = yield* peers.verify(peer);
          yield* peers.add(peer);
          yield* Console.log(
            `added ${name}: ${descriptor.label} (${descriptor.environmentId}), ${threadCount} threads`,
          );
        }),
      );
    }),
  ),
);

const listCommand = Command.make("list", { ...authLocationFlags }).pipe(
  Command.withDescription("List configured peers and whether each answers."),
  Command.withHandler((flags) =>
    runWithPeers(flags, (peers) =>
      Effect.gen(function* () {
        const statuses = yield* peers.status;
        if (statuses.length === 0) {
          yield* Console.log("No peers. Add one with `t3 peer add`.");
          return;
        }
        for (const peer of statuses) {
          yield* Console.log(
            peer.reachable
              ? `${peer.name}\t${peer.url}\t${peer.label} (${peer.environmentId}) ${peer.serverVersion}`
              : `${peer.name}\t${peer.url}\tunreachable`,
          );
        }
      }),
    ),
  ),
);

const removeCommand = Command.make("remove", {
  ...authLocationFlags,
  name: Argument.String("name").pipe(Argument.withDescription("Peer name to remove.")),
}).pipe(
  Command.withDescription("Remove a peer and its stored token."),
  Command.withHandler((flags) =>
    runWithPeers(flags, (peers) =>
      peers
        .remove(flags.name)
        .pipe(
          Effect.flatMap((removed) =>
            Console.log(removed ? `removed ${flags.name}` : `No peer named ${flags.name}.`),
          ),
        ),
    ),
  ),
);

export const peerCommand = Command.make("peer").pipe(
  Command.withDescription("Manage the other T3 servers the manager thread can reach."),
  Command.withSubcommands([addCommand, listCommand, removeCommand]),
);
