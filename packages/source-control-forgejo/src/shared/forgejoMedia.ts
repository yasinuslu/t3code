import type { SourceControlMediaUrl } from "@t3tools/source-control-core/shared/definition";

/** What Forgejo and Gitea write into a body for a dropped file, with or without the repository. */
const ATTACHMENT_PATH_PATTERN =
  /^(?:\/[^/]+\/[^/]+)?\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu;

/**
 * A private repository's attachments redirect to the login page without a credential. Any host can
 * be a forge, so this matches the shape only; the server fetches it only from a host it holds a
 * Forgejo login for.
 */
export function forgejoMediaUrl(url: URL): SourceControlMediaUrl | null {
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const id = ATTACHMENT_PATH_PATTERN.exec(url.pathname)?.[1]?.toLowerCase();
  return id
    ? { fetchUrl: `https://${url.host.toLowerCase()}/attachments/${id}`, fileName: id }
    : null;
}
