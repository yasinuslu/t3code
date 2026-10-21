const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/gi;

/** The last http(s) URL in `text`, without trailing punctuation, or null when there is none. */
export function lastUrl(text: string): string | null {
  const matches = text.match(URL_PATTERN);
  const last = matches?.at(-1);
  return last === undefined ? null : last.replace(/[.,;:!?]+$/, "");
}
