import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type {
  SourceControlProviderAuth,
  SourceControlRepositoryCloneUrls,
  SourceControlRepositoryVisibility,
} from "@t3tools/contracts";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { sanitizeBranchFragment } from "@t3tools/shared/git";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";
import {
  detectSourceControlProviderFromRemoteUrl,
  isSshRemoteUrl,
} from "@t3tools/shared/sourceControl";

import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import {
  GitCodePullRequest,
  GitCodePullRequestList,
  gitCodePullRequestState,
  gitCodeRepositoryName,
  isGitCodeCrossRepository,
} from "./gitCodePullRequests.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import { retryAtFromHeader } from "./SourceControlRateLimit.ts";

const DEFAULT_API_BASE_URL = "https://api.gitcode.com/api/v5";
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** GitCode's documented ceiling for `per_page`. */
export const GITCODE_MAX_PAGE_SIZE = 100;
/** Pull requests scanned for a branch, since GitCode's listing cannot filter by head. */
const HEAD_SEARCH_PAGES = 5;

const GitCodeApiEnvConfig = Config.all({
  baseUrl: Config.String("T3CODE_GITCODE_API_BASE_URL").pipe(
    Config.withDefault(DEFAULT_API_BASE_URL),
  ),
  accessToken: Config.String("T3CODE_GITCODE_ACCESS_TOKEN").pipe(Config.option),
});

export const GITCODE_TOKEN_HINT =
  "Create a GitCode access token at https://gitcode.com/setting/token-classic and set T3CODE_GITCODE_ACCESS_TOKEN on the server.";

/** No token is configured, which GitCode's API refuses even for public repositories. */
export class GitCodeTokenMissingError extends Schema.TaggedError<GitCodeTokenMissingError>()(
  "GitCodeTokenMissingError",
  { operation: Schema.String },
) {
  get detail(): string {
    return "T3CODE_GITCODE_ACCESS_TOKEN is not set.";
  }

  override get message(): string {
    return `GitCode API failed in ${this.operation}: ${this.detail}`;
  }
}

export class GitCodeApiError extends Schema.TaggedError<GitCodeApiError>()("GitCodeApiError", {
  operation: Schema.String,
  detail: Schema.String,
  /** The HTTP status, when GitCode answered at all. */
  status: Schema.optional(Schema.Int),
  retryAt: Schema.optional(Schema.Number),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `GitCode API failed in ${this.operation}: ${this.detail}`;
  }
}

export type GitCodeError = GitCodeTokenMissingError | GitCodeApiError;
const isGitCodeError = (value: unknown): value is GitCodeError =>
  Schema.is(GitCodeTokenMissingError)(value) || Schema.is(GitCodeApiError)(value);

export interface GitCodeRepositoryLocator {
  readonly owner: string;
  readonly repo: string;
}

export interface GitCodeRequestInput {
  readonly operation: string;
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** A path below the API base, such as `/repos/owner/repo/pulls`. */
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly body?: unknown;
  readonly maxBytes?: number;
}

const GitCodeRepository = Schema.Struct({
  full_name: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  namespace: Schema.optional(
    Schema.NullOr(Schema.Struct({ path: Schema.optional(Schema.NullOr(Schema.String)) })),
  ),
  web_url: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  http_url_to_repo: Schema.optional(Schema.NullOr(Schema.String)),
  ssh_url_to_repo: Schema.optional(Schema.NullOr(Schema.String)),
  default_branch: Schema.optional(Schema.NullOr(Schema.String)),
});

const GitCodeViewer = Schema.Struct({ login: Schema.String });

export interface NormalizedGitCodePullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state: "open" | "closed" | "merged";
  readonly isDraft?: boolean;
  readonly updatedAt: string | null;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string;
  readonly headRepositoryOwnerLogin?: string;
}

export class GitCodeApi extends Context.Service<
  GitCodeApi,
  {
    readonly probeAuth: Effect.Effect<SourceControlProviderAuth, never>;
    /** One authenticated request, returning the body undecoded. */
    readonly request: (
      input: GitCodeRequestInput,
    ) => Effect.Effect<{ readonly body: string; readonly truncated: boolean }, GitCodeError>;
    /** One authenticated request, decoded against `schema`. */
    readonly requestJson: <A>(
      input: GitCodeRequestInput,
      schema: Schema.Codec<A, unknown, never, never>,
    ) => Effect.Effect<A, GitCodeError>;
    readonly listPullRequests: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly headSelector: string;
      readonly source?: SourceControlProvider.SourceControlRefSelector;
      readonly state: "open" | "closed" | "merged" | "all";
      readonly limit?: number;
    }) => Effect.Effect<ReadonlyArray<NormalizedGitCodePullRequest>, GitCodeError>;
    readonly getPullRequest: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly reference: string;
    }) => Effect.Effect<NormalizedGitCodePullRequest, GitCodeError>;
    readonly getRepositoryCloneUrls: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly repository: string;
    }) => Effect.Effect<SourceControlRepositoryCloneUrls, GitCodeError>;
    readonly createRepository: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly visibility: SourceControlRepositoryVisibility;
    }) => Effect.Effect<SourceControlRepositoryCloneUrls, GitCodeError>;
    readonly createPullRequest: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly baseBranch: string;
      readonly headSelector: string;
      readonly source?: SourceControlProvider.SourceControlRefSelector;
      readonly target?: SourceControlProvider.SourceControlRefSelector;
      readonly title: string;
      readonly bodyFile: string;
    }) => Effect.Effect<void, GitCodeError>;
    readonly getDefaultBranch: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
    }) => Effect.Effect<string | null, GitCodeError>;
    readonly checkoutPullRequest: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly reference: string;
      readonly force?: boolean;
    }) => Effect.Effect<void, GitCodeError>;
  }
>()("t3/sourceControl/GitCodeApi") {}

export function parseGitCodeRepository(value: string): GitCodeRepositoryLocator | null {
  const parts = value
    .trim()
    .replace(/\.git$/u, "")
    .split("/")
    .filter((part) => part.length > 0);
  const owner = parts.at(-2);
  const repo = parts.at(-1);
  return owner && repo ? { owner, repo } : null;
}

export function parseGitCodeRemoteUrl(remoteUrl: string): GitCodeRepositoryLocator | null {
  const trimmed = remoteUrl.trim();
  const scpMatch = /^[a-zA-Z0-9._-]+@[^:/]+:(.+)$/u.exec(trimmed);
  if (scpMatch?.[1]) return parseGitCodeRepository(scpMatch[1]);
  try {
    return parseGitCodeRepository(new URL(trimmed).pathname);
  } catch {
    return null;
  }
}

export const gitCodeRepositoryPath = (repository: GitCodeRepositoryLocator) =>
  `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;

function normalizeChangeRequestNumber(reference: string): string {
  const trimmed = reference.trim().replace(/^[#!]/u, "");
  return /(?:pull|pulls|merge_requests)\/(\d+)(?:\D.*)?$/iu.exec(trimmed)?.[1] ?? trimmed;
}

export function normalizeGitCodePullRequest(
  pullRequest: GitCodePullRequest,
): NormalizedGitCodePullRequest {
  const headRepositoryNameWithOwner = gitCodeRepositoryName(pullRequest.head.repo);
  const headRepositoryOwnerLogin = headRepositoryNameWithOwner?.split("/")[0];
  const isCrossRepository = isGitCodeCrossRepository(pullRequest);
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.html_url,
    baseRefName: pullRequest.base.ref,
    headRefName: pullRequest.head.ref,
    state: gitCodePullRequestState(pullRequest),
    ...(pullRequest.draft === true ? { isDraft: true } : {}),
    updatedAt: pullRequest.updated_at ?? null,
    ...(isCrossRepository ? { isCrossRepository: true } : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}

function normalizeCloneUrls(
  repository: typeof GitCodeRepository.Type,
  fallback: GitCodeRepositoryLocator,
): SourceControlRepositoryCloneUrls {
  const namespace = repository.namespace?.path?.trim();
  const path = repository.path?.trim();
  const nameWithOwner =
    namespace && path ? `${namespace}/${path}` : `${fallback.owner}/${fallback.repo}`;
  const url =
    repository.http_url_to_repo?.trim() ||
    repository.web_url?.trim() ||
    repository.html_url?.trim() ||
    `https://gitcode.com/${nameWithOwner}.git`;
  return {
    nameWithOwner,
    url,
    sshUrl: repository.ssh_url_to_repo?.trim() || `git@gitcode.com:${nameWithOwner}.git`,
  };
}

function checkoutBranchName(input: {
  readonly number: number;
  readonly headBranch: string;
  readonly isCrossRepository: boolean;
}): string {
  return input.isCrossRepository
    ? `t3code/pr-${input.number}/${sanitizeBranchFragment(input.headBranch)}`
    : input.headBranch;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const config = yield* GitCodeApiEnvConfig;
  const httpClient = yield* HttpClient.HttpClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;

  const apiUrl = (path: string) => `${config.baseUrl.replace(/\/+$/u, "")}${path}`;

  const request: GitCodeApi["Service"]["request"] = (input) =>
    Effect.gen(function* () {
      if (Option.isNone(config.accessToken)) {
        return yield* new GitCodeTokenMissingError({ operation: input.operation });
      }
      const method = input.method ?? "GET";
      const url = apiUrl(input.path);
      const base =
        method === "GET"
          ? HttpClientRequest.get(url)
          : method === "POST"
            ? HttpClientRequest.post(url)
            : method === "PUT"
              ? HttpClientRequest.put(url)
              : method === "PATCH"
                ? HttpClientRequest.patch(url)
                : HttpClientRequest.make("DELETE")(url);
      const withQuery = input.query ? base.pipe(HttpClientRequest.setUrlParams(input.query)) : base;
      const withBody =
        input.body === undefined
          ? withQuery
          : withQuery.pipe(HttpClientRequest.bodyJsonUnsafe(input.body));
      const response = yield* httpClient
        .execute(
          withBody.pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bearerToken(config.accessToken.value),
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new GitCodeApiError({
                operation: input.operation,
                detail: "Failed to reach GitCode.",
                cause,
              }),
          ),
        );
      const collected = yield* collectUint8StreamText({
        stream: response.stream,
        maxBytes: input.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new GitCodeApiError({
              operation: input.operation,
              detail: "Failed to read the GitCode response.",
              status: response.status,
              cause,
            }),
        ),
      );
      if (response.status < 200 || response.status >= 300) {
        const now = yield* Clock.currentTimeMillis;
        const retryAt = retryAtFromHeader(response.headers["retry-after"], now);
        return yield* new GitCodeApiError({
          operation: input.operation,
          detail: `GitCode returned HTTP ${response.status}.`,
          status: response.status,
          ...(retryAt === undefined ? {} : { retryAt }),
        });
      }
      return { body: collected.text, truncated: collected.truncated };
    });

  const requestJson: GitCodeApi["Service"]["requestJson"] = (input, schema) =>
    request(input).pipe(
      Effect.flatMap((response) => {
        if (response.truncated) {
          return Effect.fail(
            new GitCodeApiError({
              operation: input.operation,
              detail: "GitCode response exceeded the size limit.",
            }),
          );
        }
        const decoded = decodeJsonResult(schema)(response.body);
        return Result.isSuccess(decoded)
          ? Effect.succeed(decoded.success)
          : Effect.fail(
              new GitCodeApiError({
                operation: input.operation,
                detail: "GitCode returned an invalid response.",
                cause: decoded.failure,
              }),
            );
      }),
    );

  const resolveRepository = Effect.fn("GitCodeApi.resolveRepository")(function* (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
  }) {
    if (input.context?.provider.kind === "gitcode") {
      const fromContext = parseGitCodeRemoteUrl(input.context.remoteUrl);
      if (fromContext) return fromContext;
    }
    const remotes = yield* vcsRegistry.resolve({ cwd: input.cwd }).pipe(
      Effect.flatMap((handle) => handle.driver.listRemotes(input.cwd)),
      Effect.mapError(
        (cause) =>
          new GitCodeApiError({
            operation: "resolveRepository",
            detail: `Failed to list remotes for ${input.cwd}.`,
            cause,
          }),
      ),
    );
    for (const remote of remotes.remotes) {
      if (detectSourceControlProviderFromRemoteUrl(remote.url)?.kind !== "gitcode") continue;
      const parsed = parseGitCodeRemoteUrl(remote.url);
      if (parsed) return parsed;
    }
    return yield* new GitCodeApiError({
      operation: "resolveRepository",
      detail: `No GitCode repository remote was detected for ${input.cwd}.`,
    });
  });

  const getRepository = (repository: GitCodeRepositoryLocator) =>
    requestJson(
      { operation: "getRepository", path: gitCodeRepositoryPath(repository) },
      GitCodeRepository,
    );

  const getRawPullRequest = (repository: GitCodeRepositoryLocator, reference: string) =>
    requestJson(
      {
        operation: "getPullRequest",
        path: `${gitCodeRepositoryPath(repository)}/pulls/${encodeURIComponent(normalizeChangeRequestNumber(reference))}`,
      },
      GitCodePullRequest,
    );

  const resolveCheckoutRemote = Effect.fn("GitCodeApi.resolveCheckoutRemote")(function* (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly sourceRepository: GitCodeRepositoryLocator;
    readonly isCrossRepository: boolean;
  }) {
    if (!input.isCrossRepository) {
      if (input.context?.provider.kind === "gitcode") return input.context.remoteName;
      const remoteName = yield* git
        .resolvePrimaryRemoteName(input.cwd)
        .pipe(Effect.orElseSucceed(() => null));
      if (remoteName) return remoteName;
    }
    const cloneUrls = normalizeCloneUrls(
      yield* getRepository(input.sourceRepository),
      input.sourceRepository,
    );
    const originRemoteUrl = yield* git
      .readConfigValue(input.cwd, "remote.origin.url")
      .pipe(Effect.orElseSucceed(() => null));
    return yield* git.ensureRemote({
      cwd: input.cwd,
      preferredName: input.sourceRepository.owner,
      url: originRemoteUrl && isSshRemoteUrl(originRemoteUrl) ? cloneUrls.sshUrl : cloneUrls.url,
    });
  });

  return GitCodeApi.of({
    request,
    requestJson,
    probeAuth: Option.isNone(config.accessToken)
      ? Effect.succeed({
          status: "unauthenticated",
          account: Option.none(),
          host: Option.some("gitcode.com"),
          detail: Option.some(GITCODE_TOKEN_HINT),
        })
      : requestJson({ operation: "probeAuth", path: "/user" }, GitCodeViewer).pipe(
          Effect.map((viewer): SourceControlProviderAuth => ({
            status: "authenticated",
            account: Option.some(viewer.login),
            host: Option.some("gitcode.com"),
            detail: Option.none(),
          })),
          Effect.orElseSucceed((): SourceControlProviderAuth => ({
            status: "unauthenticated",
            account: Option.none(),
            host: Option.some("gitcode.com"),
            detail: Option.some(
              "GitCode rejected T3CODE_GITCODE_ACCESS_TOKEN, or could not be reached.",
            ),
          })),
        ),
    listPullRequests: (input) =>
      Effect.gen(function* () {
        const repository = yield* resolveRepository(input);
        const branch = SourceControlProvider.sourceBranch(input);
        const owner = SourceControlProvider.sourceControlRefFromInput(input)?.owner?.toLowerCase();
        const limit = Math.max(1, input.limit ?? 20);
        const matches: NormalizedGitCodePullRequest[] = [];
        // GitCode's listing has no head filter, so recent pull requests are scanned instead.
        for (let page = 1; page <= HEAD_SEARCH_PAGES && matches.length < limit; page++) {
          const rows = yield* requestJson(
            {
              operation: "listPullRequests",
              path: `${gitCodeRepositoryPath(repository)}/pulls`,
              query: {
                state: input.state,
                sort: "updated",
                direction: "desc",
                per_page: String(GITCODE_MAX_PAGE_SIZE),
                page: String(page),
              },
            },
            GitCodePullRequestList,
          );
          for (const row of rows) {
            const normalized = normalizeGitCodePullRequest(row);
            if (normalized.headRefName !== branch) continue;
            if (owner && normalized.headRepositoryOwnerLogin?.toLowerCase() !== owner) continue;
            matches.push(normalized);
          }
          if (rows.length < GITCODE_MAX_PAGE_SIZE) break;
        }
        return matches.slice(0, limit);
      }),
    getPullRequest: (input) =>
      resolveRepository(input).pipe(
        Effect.flatMap((repository) => getRawPullRequest(repository, input.reference)),
        Effect.map(normalizeGitCodePullRequest),
      ),
    getRepositoryCloneUrls: (input) => {
      const repository = parseGitCodeRepository(input.repository);
      return repository
        ? getRepository(repository).pipe(Effect.map((raw) => normalizeCloneUrls(raw, repository)))
        : Effect.fail(
            new GitCodeApiError({
              operation: "getRepositoryCloneUrls",
              detail: "GitCode repositories are addressed as owner/repository.",
            }),
          );
    },
    createRepository: (input) =>
      Effect.gen(function* () {
        const repository = parseGitCodeRepository(input.repository);
        if (!repository) {
          return yield* new GitCodeApiError({
            operation: "createRepository",
            detail: "GitCode repositories are addressed as owner/repository.",
          });
        }
        const viewer = yield* requestJson(
          { operation: "createRepository", path: "/user" },
          GitCodeViewer,
        );
        const created = yield* requestJson(
          {
            operation: "createRepository",
            method: "POST",
            path:
              viewer.login.toLowerCase() === repository.owner.toLowerCase()
                ? "/user/repos"
                : `/orgs/${encodeURIComponent(repository.owner)}/repos`,
            body: {
              name: repository.repo,
              path: repository.repo,
              private: input.visibility === "private",
            },
          },
          GitCodeRepository,
        );
        return normalizeCloneUrls(created, repository);
      }),
    createPullRequest: (input) =>
      Effect.gen(function* () {
        const repository = yield* resolveRepository(input);
        const body = yield* fileSystem.readFileString(input.bodyFile).pipe(
          Effect.mapError(
            (cause) =>
              new GitCodeApiError({
                operation: "createPullRequest",
                detail: `Failed to read pull request body file ${input.bodyFile}.`,
                cause,
              }),
          ),
        );
        const source = SourceControlProvider.sourceControlRefFromInput(input);
        const branch = SourceControlProvider.sourceBranch(input);
        const isFork =
          source?.owner !== undefined &&
          source.owner.toLowerCase() !== repository.owner.toLowerCase();
        yield* requestJson(
          {
            operation: "createPullRequest",
            method: "POST",
            path: `${gitCodeRepositoryPath(repository)}/pulls`,
            body: {
              title: input.title,
              body,
              head: isFork ? `${source.owner}:${branch}` : branch,
              base: input.target?.refName ?? input.baseBranch,
              ...(isFork
                ? { fork_path: `${source.owner}/${source.repository ?? repository.repo}` }
                : {}),
            },
          },
          Schema.Unknown,
        );
      }),
    getDefaultBranch: (input) =>
      resolveRepository(input).pipe(
        Effect.flatMap(getRepository),
        Effect.map((repository) => repository.default_branch?.trim() || null),
      ),
    // GitCode has no checkout CLI, so the pull request's branch is fetched with git directly,
    // the same way the Bitbucket provider does it.
    checkoutPullRequest: (input) =>
      Effect.gen(function* () {
        const repository = yield* resolveRepository(input);
        const pullRequest = yield* getRawPullRequest(repository, input.reference);
        const isCrossRepository = isGitCodeCrossRepository(pullRequest);
        const sourceName = gitCodeRepositoryName(pullRequest.head.repo);
        const sourceRepository =
          (sourceName ? parseGitCodeRepository(sourceName) : null) ?? repository;
        const remoteName = yield* resolveCheckoutRemote({
          cwd: input.cwd,
          sourceRepository,
          isCrossRepository,
          ...(input.context ? { context: input.context } : {}),
        });
        const remoteBranch = pullRequest.head.ref;
        const localBranch = checkoutBranchName({
          number: pullRequest.number,
          headBranch: remoteBranch,
          isCrossRepository,
        });
        const localBranchNames = yield* git.listLocalBranchNames(input.cwd);
        if (input.force === true || !localBranchNames.includes(localBranch)) {
          yield* git.fetchRemoteBranch({ cwd: input.cwd, remoteName, remoteBranch, localBranch });
        } else {
          yield* git.fetchRemoteTrackingBranch({ cwd: input.cwd, remoteName, remoteBranch });
        }
        yield* git.setBranchUpstream({
          cwd: input.cwd,
          branch: localBranch,
          remoteName,
          remoteBranch,
        });
        yield* Effect.scoped(git.switchRef({ cwd: input.cwd, refName: localBranch }));
      }).pipe(
        Effect.mapError((cause) =>
          isGitCodeError(cause)
            ? cause
            : new GitCodeApiError({
                operation: "checkoutPullRequest",
                detail: "Failed to check out the GitCode pull request.",
                cause,
              }),
        ),
      ),
  });
});

export const layer = Layer.effect(GitCodeApi, make);

/** Whether a failure means the token is the problem, rather than this one request. */
export function gitCodeFailureReason(
  error: GitCodeError,
): "missing-tool" | "unauthenticated" | "rate-limited" | "failed" {
  if (error._tag === "GitCodeTokenMissingError") return "missing-tool";
  if (error.status === 401) return "unauthenticated";
  if (error.status === 429) return "rate-limited";
  return "failed";
}
