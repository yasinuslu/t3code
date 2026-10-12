import {
  parseThreadSegmentFromAttachmentId,
  toSafeThreadAttachmentSegment,
} from "../attachmentStore.ts";

/** Markdown links and images with a bare or bracketed target: `![alt](/abs/shot.png)`, `[a](<a b.png>)`. */
const LINK = /(!?\[[^\]]*\]\()(?:<([^>\n]+)>|([^\s()<>]+))\)/g;

const linkTarget = (match: RegExpMatchArray) => match[2] ?? match[3] ?? "";
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i;
const ATTACHMENT_TARGET = /^attachment:([A-Za-z0-9_-]+)$/;

function localImagePath(target: string): string | null {
  let path: string;
  try {
    path = decodeURI(target);
  } catch {
    return null;
  }
  return path.startsWith("/") && IMAGE_EXTENSION.test(path) ? path : null;
}

/** Absolute image paths a status report points at, in order, without repeats. */
export function localImagePaths(text: string): string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(LINK)) {
    const path = localImagePath(linkTarget(match));
    if (path) paths.add(path);
  }
  return [...paths];
}

/** Points each stored image's link at its attachment (`attachment:<id>`). */
export function linkStoredImages(text: string, stored: ReadonlyMap<string, string>): string {
  return text.replace(LINK, (whole, open: string, bracketed?: string, bare?: string) => {
    const path = localImagePath(bracketed ?? bare ?? "");
    const attachmentId = path === null ? undefined : stored.get(path);
    return attachmentId === undefined ? whole : `${open}attachment:${attachmentId})`;
  });
}

/**
 * Attachments a thread's status report shows that were stored for that
 * thread, so deleting a thread or replacing its report never removes another
 * thread's files.
 */
export function threadStatusReportAttachmentIds(
  threadId: string,
  text: string | null | undefined,
): string[] {
  const segment = toSafeThreadAttachmentSegment(threadId);
  if (segment === null || !text) return [];
  const ids = new Set<string>();
  for (const match of text.matchAll(LINK)) {
    const attachmentId = ATTACHMENT_TARGET.exec(linkTarget(match))?.[1];
    if (attachmentId && parseThreadSegmentFromAttachmentId(attachmentId) === segment) {
      ids.add(attachmentId);
    }
  }
  return [...ids];
}
