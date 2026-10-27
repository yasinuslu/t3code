import {
  defineSourceControlDriver,
  withOwnServices,
} from "@t3tools/source-control-core/server/driver";
import * as Effect from "effect/Effect";

import { definition } from "../shared/definition.ts";

import * as GitCodeApi from "./GitCodeApi.ts";
import * as GitCodePullRequestProvider from "./GitCodePullRequestProvider.ts";
import * as GitCodeSourceControlProvider from "./GitCodeSourceControlProvider.ts";

const makeInstance = Effect.all({
  sourceControl: GitCodeSourceControlProvider.make,
  discovery: GitCodeSourceControlProvider.makeDiscovery,
  pullRequests: GitCodePullRequestProvider.make,
});

export const driver = defineSourceControlDriver({
  kind: definition.kind,
  definition,
  make: withOwnServices(makeInstance, GitCodeApi.layer),
});
