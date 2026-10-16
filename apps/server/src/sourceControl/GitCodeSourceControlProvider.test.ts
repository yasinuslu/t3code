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

const listInput = { cwd: "/repo", headSelector: "feature", state: "open" } as const;

it.effect("says why a GitCode listing failed when the access token is missing", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      listPullRequests: () =>
        Effect.fail(new GitCodeApi.GitCodeTokenMissingError({ operation: "listPullRequests" })),
    });

    const error = yield* provider.listChangeRequests(listInput).pipe(Effect.flip);

    assert.include(error.detail, "Failed to list change requests.");
    assert.include(error.detail, "T3CODE_GITCODE_ACCESS_TOKEN");
  }),
);

it.effect("includes the HTTP status when GitCode rejects the request", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      listPullRequests: () =>
        Effect.fail(
          new GitCodeApi.GitCodeApiError({
            operation: "listPullRequests",
            detail: "GitCode returned HTTP 401.",
            status: 401,
          }),
        ),
    });

    const error = yield* provider.listChangeRequests(listInput).pipe(Effect.flip);

    assert.strictEqual(error.detail, "Failed to list change requests. GitCode returned HTTP 401.");
  }),
);

it.effect("keeps the generic detail when GitCode could not be reached", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      listPullRequests: () =>
        Effect.fail(
          new GitCodeApi.GitCodeApiError({
            operation: "listPullRequests",
            detail: "Failed to reach GitCode.",
          }),
        ),
    });

    const error = yield* provider.listChangeRequests(listInput).pipe(Effect.flip);

    assert.strictEqual(error.detail, "Failed to list change requests.");
  }),
);
