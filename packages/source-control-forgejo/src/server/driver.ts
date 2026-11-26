import {
  defineSourceControlDriver,
  withOwnServices,
} from "@t3tools/source-control-core/server/driver";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import { addSignedInForgejoHosts, definition } from "../shared/definition.ts";

import * as ForgejoCli from "./ForgejoCli.ts";
import * as ForgejoMediaFetch from "./forgejoMediaFetch.ts";
import * as ForgejoIssueTracker from "./ForgejoIssueTracker.ts";
import * as ForgejoPullRequestProvider from "./ForgejoPullRequestProvider.ts";
import * as ForgejoSourceControlProvider from "./ForgejoSourceControlProvider.ts";

const services = ForgejoCli.layer;

/** Teaches remote recognition the self-hosted servers an fj or gt login names. */
const recognizeSignedInHosts = Effect.fn("ForgejoDriver.recognizeSignedInHosts")(function* () {
  const { listLogins } = yield* ForgejoCli.ForgejoCli;
  if (listLogins === undefined) return;
  const cwd = yield* HostProcess.HomeDirectory;
  // Server startup waits on this, so a hung CLI must not hold it.
  const logins = yield* Effect.forEach(
    ["fj", "gt"] as const,
    (command) =>
      listLogins({ cwd, command }).pipe(
        Effect.timeout("5 seconds"),
        Effect.orElseSucceed(() => []),
      ),
    { concurrency: "unbounded" },
  );
  addSignedInForgejoHosts(
    logins
      .flat()
      .flatMap((login) => [
        ForgejoCli.parseForgejoRemote(login.url)?.hostname,
        login.ssh_host?.replace(/^[^@]*@/u, "").replace(/:\d+$/u, ""),
      ]),
  );
});

const makeInstance = Effect.all({
  sourceControl: ForgejoSourceControlProvider.make,
  discovery: ForgejoSourceControlProvider.makeDiscovery,
  pullRequests: ForgejoPullRequestProvider.make,
  fetchMedia: ForgejoMediaFetch.make,
  issues: ForgejoIssueTracker.make,
}).pipe(Effect.tap(recognizeSignedInHosts));

export const driver = defineSourceControlDriver({
  kind: definition.kind,
  definition,
  make: withOwnServices(makeInstance, services),
});
