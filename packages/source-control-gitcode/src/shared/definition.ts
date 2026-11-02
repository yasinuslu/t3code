import {
  makeProviderSettingsSchema,
  secretSetting,
  SourceControlProviderKind,
  TrimmedString,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  changeRequestUrlBelow,
  defineSourceControl,
  isChangeRequestInProjectRepository,
  isChangeRequestOnProjectHost,
  parseChangeRequestPath,
  projectChangeRequestHost,
} from "@t3tools/source-control-core/shared/definition";
import { icon } from "./icon.ts";

const KIND = SourceControlProviderKind.make("gitcode");

/** GitCode also serves the same accounts under its AtomGit brand. */
export function isGitCodeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ["gitcode.com", "atomgit.com"].some((apex) => host === apex || host.endsWith(`.${apex}`));
}

const shellWord = (value: string) =>
  /^[\w./@+-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;

/** `/{owner}/{repo}/pull/{n}`, or `/merge_requests/{n}` on older links. */
const CHANGE_REQUEST_PATH = /^\/([^/]+\/[^/]+)\/(?:pull|merge_requests)\/(\d+)(?:\/|$)/u;

function parseChangeRequestUrl(url: URL) {
  return isGitCodeHost(url.hostname) ? parseChangeRequestPath(url, CHANGE_REQUEST_PATH) : null;
}

export const settings = makeProviderSettingsSchema({
  token: TrimmedString.pipe(
    secretSetting,
    Schema.withDecodingDefault(Effect.succeed("")),
    Schema.annotateKey({
      title: "Access token",
      description:
        "A GitCode access token from gitcode.com/setting/token-classic, used before T3CODE_GITCODE_ACCESS_TOKEN and git's HTTPS credential.",
      providerSettingsForm: { control: "password" },
    }),
  ),
});
export type GitCodeSettings = typeof settings.Type;

export const definition = defineSourceControl({
  kind: KIND,
  label: "GitCode",
  pickerLabel: "GitCode",
  icon,
  searchKeywords: ["AtomGit"],
  changeRequest: {
    shortLabel: "PR",
    shortLabelWithArticle: "a PR",
    singular: "pull request",
    plural: "pull requests",
  },
  repositoryPathHint: "owner/repo",
  publicHost: "gitcode.com",
  publishDescription: "gitcode.com",
  publishHost: () => "gitcode.com",
  newRepositoryOwner: (account) => (account ? { owner: account } : null),
  defaultCloneTransport: "https",
  changeRequestUrl: ({ host, repository, number, webUrl }) =>
    webUrl
      ? changeRequestUrlBelow(webUrl, `pull/${number}`)
      : `https://${host}/${repository}/pull/${number}`,
  // `/pull/` is GitHub's shape on any hostname too, so only GitCode's own hosts claim it.
  parseChangeRequestUrl,
  changeRequestUrlFromReferenceAutolink: () => null,
  changeRequestActions: new Set(["merge", "close", "reopen"] as const),
  // GitCode has no checkout CLI, so the command clones the head branch from the head repository.
  checkoutCommand: ({ number, headBranch, headRepositoryNameWithOwner }) =>
    headRepositoryNameWithOwner
      ? `git clone --single-branch --branch ${shellWord(headBranch)} https://gitcode.com/${headRepositoryNameWithOwner}.git t3code-pr-${number}`
      : null,
  authorProfileUrl: (login, repositoryUrl) => {
    try {
      return `${new URL(repositoryUrl).origin}/${encodeURIComponent(login)}`;
    } catch {
      return null;
    }
  },
  reviewSummaryRequired: () => false,
  checkoutCommandArgument: () => null,
  isChangeRequestReference: (url) => parsePullRequestUrl(url) !== null,
  checkoutChangeRequestHost: () => null,
  recognizeRemote: ({ host, hostname }) =>
    isGitCodeHost(hostname) ? { kind: KIND, name: "GitCode", baseUrl: `https://${host}` } : null,
  isChangeRequestInRepository: (identity, link) =>
    isChangeRequestInProjectRepository(projectChangeRequestHost(identity, KIND), identity, link),
  canReadChangeRequestOnHost: (identity, link) =>
    isChangeRequestOnProjectHost(projectChangeRequestHost(identity, KIND), identity, link),
  settings,
});

export function parsePullRequestUrl(value: string) {
  try {
    return parseChangeRequestUrl(new URL(value));
  } catch {
    return null;
  }
}
