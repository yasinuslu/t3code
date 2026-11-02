import { CommandId, type ThreadId } from "@t3tools/contracts";
import { isLoopbackPreviewUrl, normalizePreviewLinkUrl } from "@t3tools/shared/threadPreviewLinks";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import {
  PreviewLinkThreadNotFoundError,
  PreviewLinkUpdateFailedError,
  PreviewLinkUrlInvalidError,
  PreviewLinkUrlLoopbackError,
  PreviewLinksToolkit,
} from "./tools.ts";

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const crypto = yield* Crypto.Crypto;

  const commandId = (tag: string, threadId: ThreadId) =>
    crypto.randomUUIDv4().pipe(
      Effect.orDie,
      Effect.map((uuid) => CommandId.make(`server:${tag}:${threadId}:${uuid}`)),
    );

  /** The calling thread and the normalized URL, or the reason there is none. */
  const resolve = Effect.fn("PreviewLinksToolkit.resolve")(function* (
    rawUrl: string,
    options: { readonly rejectLoopback: boolean },
  ) {
    const { thread: caller } = yield* McpInvocationContext.requireMcpCapability(
      "orchestration",
    ).pipe(
      Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, "Preview links")),
    );
    const url = normalizePreviewLinkUrl(rawUrl);
    if (url === null) return yield* new PreviewLinkUrlInvalidError({});
    // Unlinking stays open so a link made before this check can still be removed.
    if (options.rejectLoopback && isLoopbackPreviewUrl(url)) {
      return yield* new PreviewLinkUrlLoopbackError({ url });
    }
    const thread = yield* engine
      .getThreadShell(caller.threadId)
      .pipe(Effect.mapError((cause) => new PreviewLinkUpdateFailedError({ cause })));
    if (thread === null) {
      return yield* new PreviewLinkThreadNotFoundError({ threadId: caller.threadId });
    }
    const existing = (thread.previewLinks ?? []).find((link) => link.url === url);
    return { threadId: thread.id, url, existing };
  });

  const dispatchFailure = <E>(cause: Cause.Cause<E>) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.failCause(cause as Cause.Cause<never>)
      : Effect.fail(new PreviewLinkUpdateFailedError({ cause }));

  return {
    link_preview: McpToolAccess.actsAsCaller((input) =>
      Effect.gen(function* () {
        const { threadId, url, existing } = yield* resolve(input.url, {
          rejectLoopback: true,
        });
        yield* engine
          .dispatch({
            type: "thread.preview-link.link",
            commandId: yield* commandId("mcp-preview-link", threadId),
            threadId,
            url,
            ...(input.label === undefined ? {} : { label: input.label }),
            source: "agent",
          })
          .pipe(Effect.catchCause(dispatchFailure));
        return { url, alreadyLinked: existing !== undefined };
      }),
    ),
    unlink_preview: McpToolAccess.actsAsCaller((input) =>
      Effect.gen(function* () {
        const { threadId, url, existing } = yield* resolve(input.url, {
          rejectLoopback: false,
        });
        if (existing === undefined) return { url, wasLinked: false };
        yield* engine
          .dispatch({
            type: "thread.preview-link.unlink",
            commandId: yield* commandId("mcp-preview-unlink", threadId),
            threadId,
            url,
          })
          .pipe(Effect.catchCause(dispatchFailure));
        return { url, wasLinked: true };
      }),
    ),
  } satisfies McpToolAccess.Handlers<typeof PreviewLinksToolkit.tools>;
});

export const layer = McpToolAccess.toLayer(PreviewLinksToolkit, make);
