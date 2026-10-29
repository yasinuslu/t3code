import type { SourceControlMediaUrl } from "@t3tools/source-control-core/shared/definition";

/**
 * What a Forgejo or Gitea upload to an issue or pull request links: `/attachments/<uuid>`, on any
 * host and below any mount. A private repository's upload answers an anonymous request with a
 * redirect to the login page. The server decides whether it holds a credential for the host.
 */
const ATTACHMENT_PATH_PATTERN =
  /\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function forgejoMediaUrl(url: URL): SourceControlMediaUrl | null {
  if (!ATTACHMENT_PATH_PATTERN.test(url.pathname)) return null;
  return {
    fetchUrl: `${url.origin}${url.pathname}`,
    fileName: url.pathname.slice(url.pathname.lastIndexOf("/") + 1),
  };
}
