import {
  type ComposerContextRecord,
  type GrowRequestOutcome,
  THREAD_GROW_REQUEST_TEXT_MAX_CHARS,
  THREAD_GROW_REQUESTS_MAX,
  type ThreadGrowRequest,
} from "@t3tools/contracts";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";

/** The Grow request a user message carries, if any: its kind, and the user's own words. */
export function growRequestFromMessage(
  text: string,
  records: ReadonlyArray<ComposerContextRecord>,
  at: string,
): ThreadGrowRequest | null {
  const record = records.find((candidate) => candidate.kind === "grow-request");
  if (record === undefined || !("request" in record)) return null;
  const words = replaceComposerContextReferences(text, () => "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, THREAD_GROW_REQUEST_TEXT_MAX_CHARS);
  return {
    id: record.contextId,
    kind: record.request,
    ...(words !== "" && (record.request === "change" || record.request === "reply")
      ? { text: words }
      : {}),
    openedAt: at,
  };
}

/** The thread's requests with a new one last; the oldest fall off past the cap. */
export function openGrowRequest(
  requests: ReadonlyArray<ThreadGrowRequest> | undefined,
  request: ThreadGrowRequest,
): ReadonlyArray<ThreadGrowRequest> {
  return [...(requests ?? []).filter((existing) => existing.id !== request.id), request].slice(
    -THREAD_GROW_REQUESTS_MAX,
  );
}

/**
 * Closes the open requests `close` answers, as a patch for the thread: empty when nothing
 * changed, so answering twice is a no-op.
 */
export function closeGrowRequests(
  requests: ReadonlyArray<ThreadGrowRequest> | undefined,
  at: string,
  close: (
    request: ThreadGrowRequest,
  ) => { readonly outcome: GrowRequestOutcome; readonly note?: string } | null,
): { readonly growRequests?: ReadonlyArray<ThreadGrowRequest> } {
  if (requests === undefined) return {};
  let changed = false;
  const next = requests.map((request) => {
    if (request.closedAt !== undefined) return request;
    const answer = close(request);
    if (answer === null) return request;
    changed = true;
    return { ...request, closedAt: at, ...answer };
  });
  return changed ? { growRequests: next } : {};
}

/** When an agent last answered a request with "blocked", so Grow can hand the thread back. */
export function growBlockedAt(
  requests: ReadonlyArray<ThreadGrowRequest> | undefined,
): string | undefined {
  let latest: string | undefined;
  for (const request of requests ?? []) {
    const at = request.outcome === "blocked" ? request.closedAt : undefined;
    if (at !== undefined && (latest === undefined || at > latest)) latest = at;
  }
  return latest;
}

/** When the requests last changed, for clients to know their copy is stale. */
export function growRequestsUpdatedAt(
  requests: ReadonlyArray<ThreadGrowRequest> | undefined,
): string | undefined {
  let latest: string | undefined;
  for (const request of requests ?? []) {
    for (const at of [request.openedAt, request.closedAt]) {
      if (at !== undefined && (latest === undefined || at > latest)) latest = at;
    }
  }
  return latest;
}
