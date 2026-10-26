import * as Schema from "effect/Schema";

/**
 * GitCode's v5 API is Gitee-shaped and its documented examples disagree with themselves on
 * field types (ids are strings on one endpoint and numbers on the next), so everything not
 * needed to identify a pull request is optional and loosely typed.
 */
const Text = Schema.optional(Schema.NullOr(Schema.String));

export const GitCodeUser = Schema.Struct({
  login: Text,
  name: Text,
  avatar_url: Text,
});
export type GitCodeUser = typeof GitCodeUser.Type;

export const GitCodeRepositoryRef = Schema.Struct({
  full_name: Text,
  full_path: Text,
  path: Text,
  namespace: Schema.optional(Schema.NullOr(Schema.Struct({ path: Text }))),
});

const GitCodeBranch = Schema.Struct({
  ref: Schema.String,
  sha: Text,
  repo: Schema.optional(Schema.NullOr(GitCodeRepositoryRef)),
});

export const GitCodeLabel = Schema.Struct({
  name: Schema.String,
  color: Text,
});

export const GitCodePullRequest = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  body: Text,
  html_url: Schema.String,
  state: Schema.String,
  draft: Schema.optional(Schema.NullOr(Schema.Boolean)),
  mergeable: Schema.optional(Schema.NullOr(Schema.Boolean)),
  locked: Schema.optional(Schema.NullOr(Schema.Boolean)),
  user: Schema.optional(Schema.NullOr(GitCodeUser)),
  head: GitCodeBranch,
  base: GitCodeBranch,
  created_at: Schema.String,
  updated_at: Text,
  closed_at: Text,
  merged_at: Text,
  labels: Schema.optional(Schema.NullOr(Schema.Array(GitCodeLabel))),
  approval_reviewers: Schema.optional(Schema.NullOr(Schema.Array(GitCodeUser))),
});
export type GitCodePullRequest = typeof GitCodePullRequest.Type;

export const GitCodePullRequestList = Schema.Array(GitCodePullRequest);

/** `owner/repo` for a branch's repository, from whichever of GitCode's spellings is present. */
export function gitCodeRepositoryName(
  repository: typeof GitCodeRepositoryRef.Type | null | undefined,
): string | null {
  if (!repository) return null;
  const direct = repository.full_path?.trim() || repository.full_name?.trim();
  if (direct && direct.includes("/") && !direct.includes(" ")) return direct;
  const namespace = repository.namespace?.path?.trim();
  const path = repository.path?.trim();
  return namespace && path ? `${namespace}/${path}` : null;
}

export function gitCodePullRequestState(
  pullRequest: Pick<GitCodePullRequest, "state" | "merged_at">,
): "open" | "closed" | "merged" {
  const state = pullRequest.state.trim().toLowerCase();
  if (state === "merged" || pullRequest.merged_at) return "merged";
  return state === "open" || state === "opened" || state === "locked" ? "open" : "closed";
}

export function isGitCodeCrossRepository(pullRequest: GitCodePullRequest): boolean {
  const head = gitCodeRepositoryName(pullRequest.head.repo);
  const base = gitCodeRepositoryName(pullRequest.base.repo);
  return head !== null && base !== null && head.toLowerCase() !== base.toLowerCase();
}
