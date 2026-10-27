import { OrchestrationGetWorkflowScriptError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { CodeProfiles } from "../provider/CodeProfiles.ts";
import { readContainedWorkflowFile } from "./workflowFileRead.ts";

/** ~/.claude first, then each code profile's Claude dir: a profile's scripts live under its own dir. */
const configDirCandidates = Effect.gen(function* () {
  const codeProfiles = yield* Effect.serviceOption(CodeProfiles);
  const profileDirs = Option.isSome(codeProfiles)
    ? (yield* codeProfiles.value.claudeConfigDirs).map((entry) => entry.dir)
    : [];
  return [undefined, ...profileDirs];
});

export const readWorkflowScript = Effect.fn("orchestration.readWorkflowScript")(function* (input: {
  readonly scriptPath: string;
}) {
  const configDirs = yield* configDirCandidates;
  const readUnder = (index: number): ReturnType<typeof readContainedWorkflowFile> =>
    readContainedWorkflowFile({
      path: input.scriptPath,
      extension: ".js",
      byteCap: 256 * 1024,
      ...(configDirs[index] === undefined ? {} : { configDir: configDirs[index] }),
    }).pipe(
      Effect.catchIf(
        (error) =>
          index + 1 < configDirs.length &&
          (error.reason === "outside-root" || error.reason === "root-unavailable"),
        () => readUnder(index + 1),
      ),
    );
  const file = yield* readUnder(0).pipe(
    Effect.mapError(
      (error) =>
        new OrchestrationGetWorkflowScriptError({
          reason: error.reason === "wrong-extension" ? "not-js" : error.reason,
          scriptPath: error.path,
          cause: error,
        }),
    ),
  );
  return { scriptPath: file.path, contents: file.contents, truncated: file.truncated };
});
