import {
  ComposerContextId,
  type EnvironmentId,
  type GrowRequestKind,
  type ThreadId,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";

import { newMessageId, randomUUID } from "../../lib/utils";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

/** The chip a Grow request shows as in the conversation. */
const GROW_REQUEST_LABEL: Record<GrowRequestKind, string> = {
  presentation: "Presentation",
  ship: "Ship",
  change: "What if",
  reply: "Reply",
  form: "Answers",
};

/**
 * Sends a typed request to a thread: the agent reads what it asks, and the thread keeps the
 * request (under `id` when given) until it is answered. Used by Grow and by the presentation
 * panel, which answers a form page the same way. Resolves false when the thread was not reached.
 */
export function useSendGrowRequest() {
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  return async (
    thread: Pick<EnvironmentThreadShell, "runtimeMode" | "interactionMode"> & {
      readonly environmentId: EnvironmentId;
      readonly id: ThreadId;
    },
    request: GrowRequestKind,
    words: string,
    options?: { readonly dispatchMode?: "queue"; readonly id?: string },
  ): Promise<boolean> => {
    const contextId = ComposerContextId.make(options?.id ?? `grow-${randomUUID()}`);
    const label = GROW_REQUEST_LABEL[request];
    const reference = formatComposerContextReference({ kind: "grow-request", contextId, label });
    const result = await startTurn({
      environmentId: thread.environmentId,
      input: {
        threadId: thread.id,
        ...(options?.dispatchMode === undefined ? {} : { dispatchMode: options.dispatchMode }),
        message: {
          messageId: newMessageId(),
          role: "user",
          text: words === "" ? reference : `${reference} ${words}`,
          context: {
            version: 1,
            records: [{ version: 1, contextId, kind: "grow-request", label, request }],
          },
          attachments: [],
        },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
      },
    });
    return result._tag !== "Failure";
  };
}
