import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type {
  PullRequestActor,
  PullRequestCapabilities,
  PullRequestComment,
  PullRequestViewerPermissions,
} from "@t3tools/contracts";

import {
  GitCodeApi,
  gitCodeFailureReason,
  gitCodeRepositoryPath,
  parseGitCodeRepository,
  GITCODE_MAX_PAGE_SIZE,
  type GitCodeError,
  type GitCodeRequestInput,
} from "../sourceControl/GitCodeApi.ts";
import {
  GitCodePullRequest,
  GitCodePullRequestList,
  GitCodeUser,
  gitCodePullRequestState,
  gitCodeRepositoryName,
} from "../sourceControl/gitCodePullRequests.ts";
import {
  PullRequestProviderError,
  type ProviderChangeRequest,
  type ProviderChangeRequestDetail,
  type ProviderRepositoryRef,
  type PullRequestProviderApi,
} from "./PullRequestProvider.ts";

/**
 * GitCode's v5 API reads pull requests, their comments, commits and files, and merges, closes
 * and approves them. It has no reactions, and its line-comment and reviewer endpoints are too
 * loosely documented to write against, so those stay off.
 */
const CAPABILITIES: PullRequestCapabilities = {
  diff: true,
  comment: true,
  actions: ["merge", "close", "reopen"],
  mergeMethods: ["merge", "squash", "rebase"],
  search: false,
  reactions: false,
  labels: false,
  review: {
    inlineComment: false,
    reply: false,
    resolve: false,
    verdicts: ["comment", "approve"],
  },
  reviewers: { request: false, listCandidates: false },
  edit: { changeRequest: true, comment: true },
};

/** Pages of conversation, commits or files to read before reporting the rest as cut off. */
const MAX_PAGES = 5;

const Count = Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String])));
const Flag = Schema.optional(Schema.NullOr(Schema.Union([Schema.Boolean, Schema.Number])));

const GitCodeCommentBase = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Number]),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
  user: Schema.optional(Schema.NullOr(GitCodeUser)),
  comment_type: Schema.optional(Schema.NullOr(Schema.String)),
  resolved: Schema.optional(Schema.NullOr(Schema.Boolean)),
  diff_file: Schema.optional(Schema.NullOr(Schema.String)),
  diff_position: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        end_new_line: Count,
        end_old_line: Count,
      }),
    ),
  ),
});
const GitCodeComment = Schema.Struct({
  ...GitCodeCommentBase.fields,
  reply: Schema.optional(Schema.NullOr(Schema.Array(GitCodeCommentBase))),
});
type GitCodeComment = typeof GitCodeComment.Type;

const GitCodeCommit = Schema.Struct({
  sha: Schema.String,
  author: Schema.optional(Schema.NullOr(GitCodeUser)),
  commit: Schema.Struct({
    message: Schema.String,
    author: Schema.optional(Schema.NullOr(Schema.Struct({ date: Schema.optional(Schema.String) }))),
    committer: Schema.optional(
      Schema.NullOr(Schema.Struct({ date: Schema.optional(Schema.String) })),
    ),
  }),
});

const GitCodeFile = Schema.Struct({
  filename: Schema.optional(Schema.NullOr(Schema.String)),
  additions: Count,
  deletions: Count,
  patch: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        diff: Schema.optional(Schema.NullOr(Schema.String)),
        old_path: Schema.optional(Schema.NullOr(Schema.String)),
        new_path: Schema.optional(Schema.NullOr(Schema.String)),
        a_mode: Schema.optional(Schema.NullOr(Schema.String)),
        b_mode: Schema.optional(Schema.NullOr(Schema.String)),
        new_file: Flag,
        deleted_file: Flag,
        renamed_file: Flag,
        too_large: Flag,
      }),
    ),
  ),
});
type GitCodeFile = typeof GitCodeFile.Type;

const count = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
};

const toIsoUtc = (value: string | null | undefined): string | null =>
  value
    ? Option.match(DateTime.make(value), { onNone: () => value, onSome: DateTime.formatIso })
    : null;

function gitCodeActor(user: typeof GitCodeUser.Type | null | undefined): PullRequestActor | null {
  const login = user?.login?.trim();
  return login ? { login, name: user?.name || null, avatarUrl: user?.avatar_url || null } : null;
}

function gitCodeChangeRequest(pullRequest: GitCodePullRequest): ProviderChangeRequest {
  const createdAt = toIsoUtc(pullRequest.created_at) ?? pullRequest.created_at;
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.html_url,
    author: gitCodeActor(pullRequest.user),
    headBranch: pullRequest.head.ref,
    headRepositoryNameWithOwner: gitCodeRepositoryName(pullRequest.head.repo),
    baseBranch: pullRequest.base.ref,
    state: gitCodePullRequestState(pullRequest),
    isDraft: pullRequest.draft === true,
    mergeability:
      pullRequest.mergeable === undefined || pullRequest.mergeable === null
        ? "unknown"
        : pullRequest.mergeable
          ? "mergeable"
          : "conflicting",
    additions: 0,
    deletions: 0,
    createdAt,
    updatedAt: toIsoUtc(pullRequest.updated_at) ?? createdAt,
    closedAt: toIsoUtc(pullRequest.closed_at),
    mergedAt: toIsoUtc(pullRequest.merged_at),
    reviewRequestLogins: [],
    labels: (pullRequest.labels ?? []).map((label) => ({
      name: label.name,
      color: label.color ?? null,
    })),
  };
}

function gitCodeComment(comment: typeof GitCodeCommentBase.Type, path: string | null) {
  return {
    id: String(comment.id),
    kind: path === null ? "issue-comment" : "review-comment",
    author: gitCodeActor(comment.user),
    body: comment.body ?? "",
    createdAt: toIsoUtc(comment.created_at) ?? comment.created_at,
    url: null,
    path,
    reviewState: null,
  } satisfies PullRequestComment;
}

/** The files GitCode reports, joined back into the unified patch the diff view reads. */
export function gitCodeFilesToPatch(files: ReadonlyArray<GitCodeFile>): {
  readonly patch: string;
  readonly truncated: boolean;
} {
  let truncated = false;
  const sections = files.map((file) => {
    const patch = file.patch;
    const newPath = patch?.new_path || file.filename || "";
    const oldPath = patch?.old_path || newPath;
    const isNew = Boolean(patch?.new_file);
    const isDeleted = Boolean(patch?.deleted_file);
    const lines = [`diff --git a/${oldPath} b/${newPath}`];
    if (isNew) lines.push(`new file mode ${patch?.b_mode || "100644"}`);
    if (isDeleted) lines.push(`deleted file mode ${patch?.a_mode || "100644"}`);
    if (patch?.renamed_file && oldPath !== newPath) {
      lines.push(`rename from ${oldPath}`, `rename to ${newPath}`);
    }
    const diff = patch?.diff ?? "";
    if (patch?.too_large) truncated = true;
    if (diff.length > 0) {
      lines.push(
        isNew ? "--- /dev/null" : `--- a/${oldPath}`,
        isDeleted ? "+++ /dev/null" : `+++ b/${newPath}`,
        diff.endsWith("\n") ? diff.slice(0, -1) : diff,
      );
    }
    return lines.join("\n");
  });
  return { patch: sections.length === 0 ? "" : `${sections.join("\n")}\n`, truncated };
}

export const make = Effect.gen(function* () {
  const api = yield* GitCodeApi;

  const toProviderError = (operation: string) => (error: GitCodeError) => {
    const retryAt = error._tag === "GitCodeApiError" ? error.retryAt : undefined;
    return new PullRequestProviderError({
      provider: "gitcode",
      operation,
      reason: gitCodeFailureReason(error),
      detail: error.detail,
      ...(retryAt === undefined ? {} : { retryAt }),
      cause: error,
    });
  };
  const failure = (operation: string, detail: string) =>
    new PullRequestProviderError({ provider: "gitcode", operation, reason: "failed", detail });

  const repoPath = Effect.fn("GitCodePullRequestProvider.repoPath")(function* (
    input: ProviderRepositoryRef,
  ) {
    const repository = parseGitCodeRepository(input.repository);
    if (!repository) {
      return yield* failure(
        "resolveRepository",
        "GitCode repositories are addressed as owner/repository.",
      );
    }
    return gitCodeRepositoryPath(repository);
  });
  const read = <A>(input: GitCodeRequestInput, schema: Schema.Codec<A, unknown, never, never>) =>
    api.requestJson(input, schema).pipe(Effect.mapError(toProviderError(input.operation)));
  const write = (input: GitCodeRequestInput) =>
    api.request(input).pipe(Effect.asVoid, Effect.mapError(toProviderError(input.operation)));
  /** Every page of a listing, up to `MAX_PAGES`, and whether that ceiling cut it short. */
  const readAll = Effect.fn("GitCodePullRequestProvider.readAll")(function* <A>(
    input: GitCodeRequestInput,
    schema: Schema.Codec<A, unknown, never, never>,
  ) {
    const items: A[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = yield* read(
        {
          ...input,
          query: { ...input.query, per_page: String(GITCODE_MAX_PAGE_SIZE), page: String(page) },
        },
        Schema.NullOr(Schema.Array(schema)),
      );
      items.push(...(rows ?? []));
      if ((rows ?? []).length < GITCODE_MAX_PAGE_SIZE) return { items, truncated: false };
    }
    return { items, truncated: true };
  });

  const pullPath = (input: ProviderRepositoryRef & { readonly number: number }) =>
    repoPath(input).pipe(Effect.map((path) => `${path}/pulls/${input.number}`));
  const getPull = (input: ProviderRepositoryRef & { readonly number: number }) =>
    pullPath(input).pipe(
      Effect.flatMap((path) => read({ operation: "getChangeRequest", path }, GitCodePullRequest)),
    );
  const getFiles = (input: ProviderRepositoryRef & { readonly number: number }) =>
    pullPath(input).pipe(
      Effect.flatMap((path) =>
        // The files endpoint is documented without paging; it answers with every file at once.
        read(
          { operation: "getDiff", path: `${path}/files` },
          Schema.NullOr(Schema.Array(GitCodeFile)),
        ),
      ),
      Effect.map((files) => files ?? []),
    );
  const getViewer = () =>
    read({ operation: "getViewer", path: "/user" }, Schema.Struct({ login: Schema.String })).pipe(
      Effect.map((user) => user.login),
    );

  const permissions = (
    pullRequest: GitCodePullRequest,
    viewer: string,
  ): PullRequestViewerPermissions => {
    // GitCode reports no permissions on a repository or pull request. An unreported permission
    // is granted, and GitCode refuses what the account may not do with its own message.
    const state = gitCodePullRequestState(pullRequest);
    const isAuthor = pullRequest.user?.login?.toLowerCase() === viewer.toLowerCase();
    return {
      actions: state === "open" ? ["merge", "close"] : state === "closed" ? ["reopen"] : [],
      comment: pullRequest.locked !== true,
      resolve: false,
      verdicts: state !== "open" ? [] : isAuthor ? ["comment"] : ["comment", "approve"],
      requestReviewers: false,
    };
  };
  const unsupported = (operation: string) =>
    Effect.fail(failure(operation, `GitCode does not support ${operation} here.`));

  const provider: PullRequestProviderApi = {
    kind: "gitcode",
    capabilities: CAPABILITIES,
    getViewer,
    listChangeRequests: Effect.fn("GitCodePullRequestProvider.listChangeRequests")(
      function* (input) {
        const path = yield* repoPath(input);
        const pageSize = 50;
        const offset = input.cursor?.delivered ?? 0;
        const involvement =
          input.involvement === "authored"
            ? { author: input.viewer }
            : input.involvement === "reviewing"
              ? { reviewer: input.viewer }
              : {};
        const items: ProviderChangeRequest[] = [];
        let consumed = 0;
        let more = true;
        const firstPage = Math.floor(offset / pageSize) + 1;
        for (let page = firstPage; more && consumed < input.limit; page++) {
          const rows = yield* read(
            {
              operation: "listChangeRequests",
              path: `${path}/pulls`,
              query: {
                state: input.state,
                sort: "updated",
                direction: "desc",
                per_page: String(pageSize),
                page: String(page),
                ...involvement,
              },
            },
            GitCodePullRequestList,
          );
          const start = page === firstPage ? offset % pageSize : 0;
          const available = rows.slice(start);
          const taken = available.slice(0, input.limit - consumed);
          items.push(...taken.map(gitCodeChangeRequest));
          consumed += taken.length;
          more = rows.length === pageSize || taken.length < available.length;
        }
        return { items, truncated: more, continues: true, cursorAdvance: consumed };
      },
    ),
    getChangeRequestSummary: (input) => getPull(input).pipe(Effect.map(gitCodeChangeRequest)),
    getChangeRequest: Effect.fn("GitCodePullRequestProvider.getChangeRequest")(function* (input) {
      const [pullRequest, files, viewer] = yield* Effect.all(
        [getPull(input), getFiles(input), getViewer()],
        { concurrency: 3 },
      );
      return {
        ...gitCodeChangeRequest(pullRequest),
        additions: files.reduce((total, file) => total + count(file.additions), 0),
        deletions: files.reduce((total, file) => total + count(file.deletions), 0),
        body: pullRequest.body ?? "",
        changedFiles: files.length,
        mergedAt: toIsoUtc(pullRequest.merged_at),
        closedAt: toIsoUtc(pullRequest.closed_at),
        reviewers: (pullRequest.approval_reviewers ?? []).flatMap((user) => {
          const actor = gitCodeActor(user);
          return actor ? [actor] : [];
        }),
        checks: [],
        viewerPermissions: permissions(pullRequest, viewer),
        mergeCapabilities: { merge: true, squash: true, rebase: true },
      } satisfies ProviderChangeRequestDetail;
    }),
    getViewerPermissions: Effect.fn("GitCodePullRequestProvider.getViewerPermissions")(
      function* (input) {
        const [pullRequest, viewer] = yield* Effect.all([getPull(input), getViewer()], {
          concurrency: 2,
        });
        return permissions(pullRequest, viewer);
      },
    ),
    getChangeRequestActivity: Effect.fn("GitCodePullRequestProvider.getChangeRequestActivity")(
      function* (input) {
        const path = yield* pullPath(input);
        const [comments, commits] = yield* Effect.all(
          [
            readAll(
              { operation: "getChangeRequestActivity", path: `${path}/comments` },
              GitCodeComment,
            ),
            readAll(
              { operation: "getChangeRequestActivity", path: `${path}/commits` },
              GitCodeCommit,
            ),
          ],
          { concurrency: 2 },
        );
        const isLineComment = (comment: GitCodeComment) =>
          comment.comment_type === "diff_comment" || Boolean(comment.diff_file);
        const timeline = comments.items
          .flatMap((comment) => {
            const path = isLineComment(comment) ? (comment.diff_file ?? null) : null;
            return [comment, ...(comment.reply ?? [])].map((entry) => gitCodeComment(entry, path));
          })
          .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
        return {
          comments: timeline,
          commentCount: timeline.length,
          commentsTruncated: comments.truncated,
          reviewThreads: comments.items.flatMap((comment) => {
            if (!isLineComment(comment) || !comment.diff_file) return [];
            const newLine = count(comment.diff_position?.end_new_line);
            const oldLine = count(comment.diff_position?.end_old_line);
            return [
              {
                id: String(comment.id),
                path: comment.diff_file,
                line: newLine || oldLine || null,
                side: newLine === 0 && oldLine > 0 ? ("left" as const) : ("right" as const),
                isResolved: comment.resolved === true,
                isOutdated: false,
                comments: [comment, ...(comment.reply ?? [])].map((entry) => {
                  const {
                    kind: _kind,
                    path: _path,
                    reviewState: _state,
                    ...rest
                  } = gitCodeComment(entry, comment.diff_file ?? null);
                  return rest;
                }),
              },
            ];
          }),
          // A commit GitCode reports without a date has no place on the timeline.
          commits: commits.items.flatMap((commit) => {
            const author = gitCodeActor(commit.author);
            const committedDate = toIsoUtc(
              commit.commit.committer?.date ?? commit.commit.author?.date,
            );
            return committedDate === null
              ? []
              : [
                  {
                    oid: commit.sha,
                    messageHeadline: commit.commit.message.split("\n")[0] ?? "",
                    committedDate,
                    authors: author ? [author] : [],
                  },
                ];
          }),
        };
      },
    ),
    getDiff: (input) =>
      input.commit
        ? unsupported("a single commit's diff")
        : getFiles(input).pipe(
            Effect.map((files) => ({ ...gitCodeFilesToPatch(files), nextCursor: null })),
          ),
    runAction: Effect.fn("GitCodePullRequestProvider.runAction")(function* (input) {
      const path = yield* pullPath(input);
      switch (input.action) {
        case "merge":
          return yield* write({
            operation: "merge",
            method: "PUT",
            path: `${path}/merge`,
            body: {
              merge_method: input.mergeMethod === "rebase" ? "rebase" : "merge",
              squash: input.mergeMethod === "squash",
            },
          });
        case "close":
        case "reopen":
          return yield* write({
            operation: input.action,
            method: "PATCH",
            path,
            body: { state: input.action === "close" ? "closed" : "open" },
          });
        default:
          return yield* unsupported(input.action);
      }
    }),
    updateChangeRequest: (input) =>
      pullPath(input).pipe(
        Effect.flatMap((path) =>
          write({
            operation: "updateChangeRequest",
            method: "PATCH",
            path,
            body: {
              ...(input.title === undefined ? {} : { title: input.title }),
              ...(input.body === undefined ? {} : { body: input.body }),
            },
          }),
        ),
      ),
    comment: (input) =>
      pullPath(input).pipe(
        Effect.flatMap((path) =>
          write({
            operation: "comment",
            method: "POST",
            path: `${path}/comments`,
            body: { body: input.body },
          }),
        ),
      ),
    updateComment: (input) =>
      repoPath(input).pipe(
        Effect.flatMap((path) =>
          write({
            operation: "updateComment",
            method: "PATCH",
            path: `${path}/pulls/comments/${encodeURIComponent(input.commentId)}`,
            body: { body: input.body },
          }),
        ),
      ),
    submitReview: Effect.fn("GitCodePullRequestProvider.submitReview")(function* (input) {
      const path = yield* pullPath(input);
      if (input.verdict === "approve") {
        yield* write({
          operation: "submitReview",
          method: "POST",
          path: `${path}/review`,
          body: {},
        });
      } else if (input.verdict !== "comment") {
        return yield* unsupported(input.verdict);
      }
      if (input.body.trim().length > 0) {
        yield* write({
          operation: "submitReview",
          method: "POST",
          path: `${path}/comments`,
          body: { body: input.body },
        });
      }
    }),
    listReviewerCandidates: () => unsupported("reviewer requests"),
    setReviewerRequest: () => unsupported("reviewer requests"),
    replyToThread: () => unsupported("thread replies"),
    setReaction: () => unsupported("reactions"),
    setThreadResolution: () => unsupported("thread resolution"),
  };
  return provider;
});
