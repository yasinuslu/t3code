/** Markdown links and images whose target is a local image file: `![alt](/abs/shot.png)`. */
const LINK = /(!?\[[^\]]*\]\()(<?)([^)\s>]+)(>?\))/g;
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i;

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
    const path = localImagePath(match[3] ?? "");
    if (path) paths.add(path);
  }
  return [...paths];
}

/** Points each stored image's link at its attachment (`attachment:<id>`). */
export function linkStoredImages(text: string, stored: ReadonlyMap<string, string>): string {
  return text.replace(LINK, (whole, open: string, _lt, target: string, close: string) => {
    const path = localImagePath(target);
    const attachmentId = path === null ? undefined : stored.get(path);
    return attachmentId === undefined
      ? whole
      : `${open}attachment:${attachmentId}${close.replace(/^>/, "")}`;
  });
}
