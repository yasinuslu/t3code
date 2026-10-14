import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { SourceControlProviderError, type ChangeRequest } from "@t3tools/contracts";

import * as GitCodeApi from "./GitCodeApi.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import type { SourceControlApiDiscoverySpec } from "./SourceControlProviderDiscovery.ts";

function toChangeRequest(summary: GitCodeApi.NormalizedGitCodePullRequest): ChangeRequest {
  return {
    provider: "gitcode",
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    state: summary.state,
    ...(summary.isDraft === true ? { isDraft: true } : {}),
    updatedAt:
      summary.updatedAt === null
        ? Option.none()
        : DateTime.make(summary.updatedAt).pipe(Option.map(DateTime.toUtc)),
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
  };
}

/**
 * The provider error's detail names why GitCode failed ("GitCode returned HTTP 401.", a missing
 * token), because the toast shows nothing but this line. Only the curated `detail` of GitCode's
 * own errors is used, never the raw transport cause.
 */
function withGitCodeReason(summary: string, error: GitCodeApi.GitCodeError): string {
  return `${summary}: ${error.detail}`;
}

export const make = Effect.gen(function* () {
  const gitcode = yield* GitCodeApi.GitCodeApi;

  return SourceControlProvider.SourceControlProvider.of({
    kind: "gitcode",
    listChangeRequests: (input) => {
      const source = SourceControlProvider.sourceControlRefFromInput(input);
      return gitcode
        .listPullRequests({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          headSelector: input.headSelector,
          ...(source ? { source } : {}),
          state: input.state,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
        .pipe(
          Effect.map((items) => items.map(toChangeRequest)),
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "gitcode",
                operation: "listChangeRequests",
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.headSelector,
                ),
                detail: withGitCodeReason("Failed to list change requests", error),
                cause: error,
              }),
          ),
        );
    },
    getChangeRequest: (input) =>
      gitcode.getPullRequest(input).pipe(
        Effect.map(toChangeRequest),
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "gitcode",
              operation: "getChangeRequest",
              cwd: input.cwd,
              reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.reference,
              ),
              detail: withGitCodeReason("Failed to get change request", error),
              cause: error,
            }),
        ),
      ),
    createChangeRequest: (input) => {
      const source = SourceControlProvider.sourceControlRefFromInput(input);
      return gitcode
        .createPullRequest({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          baseBranch: input.baseRefName,
          headSelector: input.headSelector,
          ...(source ? { source } : {}),
          ...(input.target ? { target: input.target } : {}),
          title: input.title,
          bodyFile: input.bodyFile,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "gitcode",
                operation: "createChangeRequest",
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.headSelector,
                ),
                detail: withGitCodeReason("Failed to create change request", error),
                cause: error,
              }),
          ),
        );
    },
    getRepositoryCloneUrls: (input) =>
      gitcode.getRepositoryCloneUrls(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "gitcode",
              operation: "getRepositoryCloneUrls",
              cwd: input.cwd,
              repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.repository,
              ),
              detail: withGitCodeReason("Failed to get repository clone URLs", error),
              cause: error,
            }),
        ),
      ),
    createRepository: (input) =>
      gitcode.createRepository(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "gitcode",
              operation: "createRepository",
              cwd: input.cwd,
              repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.repository,
              ),
              detail: withGitCodeReason("Failed to create repository", error),
              cause: error,
            }),
        ),
      ),
    getDefaultBranch: (input) =>
      gitcode
        .getDefaultBranch({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "gitcode",
                operation: "getDefaultBranch",
                cwd: input.cwd,
                detail: withGitCodeReason("Failed to get default branch", error),
                cause: error,
              }),
          ),
        ),
    checkoutChangeRequest: (input) =>
      gitcode
        .checkoutPullRequest({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          reference: input.reference,
          ...(input.force !== undefined ? { force: input.force } : {}),
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "gitcode",
                operation: "checkoutChangeRequest",
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.reference,
                ),
                detail: withGitCodeReason("Failed to check out change request", error),
                cause: error,
              }),
          ),
        ),
  });
});

export const makeDiscovery = Effect.gen(function* () {
  const gitcode = yield* GitCodeApi.GitCodeApi;

  return {
    type: "api",
    kind: "gitcode",
    label: "GitCode",
    installHint: GitCodeApi.GITCODE_TOKEN_HINT,
    probeAuth: gitcode.probeAuth,
  } satisfies SourceControlApiDiscoverySpec;
});
