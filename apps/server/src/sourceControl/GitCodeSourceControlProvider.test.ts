import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GitCodeApi from "./GitCodeApi.ts";
import * as GitCodeSourceControlProvider from "./GitCodeSourceControlProvider.ts";

function makeProvider(gitcode: Partial<GitCodeApi.GitCodeApi["Service"]>) {
  return GitCodeSourceControlProvider.make.pipe(
    Effect.provide(Layer.mock(GitCodeApi.GitCodeApi)(gitcode)),
  );
}

const listInput = {
  cwd: "/repo",
  headSelector: "feature/x",
  state: "open",
} as const;

it.effect("names the HTTP failure in the list error detail", () =>
  Effect.gen(function* () {
    const cause = new GitCodeApi.GitCodeApiError({
      operation: "listPullRequests",
      detail: "GitCode returned HTTP 401.",
      status: 401,
    });
    const provider = yield* makeProvider({ listPullRequests: () => Effect.fail(cause) });

    const error = yield* provider.listChangeRequests(listInput).pipe(Effect.flip);

    assert.strictEqual(error.detail, "Failed to list change requests: GitCode returned HTTP 401.");
    assert.strictEqual(error.cause, cause);
  }),
);

it.effect("tells a missing token apart from a failed request", () =>
  Effect.gen(function* () {
    const cause = new GitCodeApi.GitCodeTokenMissingError({ operation: "listPullRequests" });
    const provider = yield* makeProvider({ listPullRequests: () => Effect.fail(cause) });

    const error = yield* provider.listChangeRequests(listInput).pipe(Effect.flip);

    assert.strictEqual(
      error.detail,
      "Failed to list change requests: T3CODE_GITCODE_ACCESS_TOKEN is not set, and git has no HTTPS credential for gitcode.com.",
    );
  }),
);
