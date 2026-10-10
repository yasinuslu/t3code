import { useNavigation } from "@react-navigation/native";
import type {
  EnvironmentId,
  ThreadId,
  ThreadPreviewLink,
  ThreadPreviewLinkState,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useCallback } from "react";
import { Alert, Keyboard } from "react-native";

import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { refreshPreviewLinkStates } from "../../state/preview-links";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { parsePreviewLinkMenuEvent } from "./threadPreviewLinkPresentation";

/** Open, open externally, copy, and remove a thread's preview links. */
export function usePreviewLinkActions(environmentId: EnvironmentId, threadId: ThreadId) {
  const navigation = useNavigation();
  const unlink = useAtomCommand(threadEnvironment.unlinkPreview, { reportFailure: false });

  const open = useCallback(
    (link: ThreadPreviewLink, state: ThreadPreviewLinkState) => {
      if (state === "gone") {
        Alert.alert(
          "This preview was removed",
          "Its host no longer serves it. Remove the link, or ask the agent for a new preview.",
        );
        return;
      }
      Keyboard.dismiss();
      navigation.navigate("ThreadPreviewLink", { environmentId, threadId, url: link.url });
    },
    [environmentId, navigation, threadId],
  );

  const openExternal = useCallback(
    (link: ThreadPreviewLink) => {
      void tryOpenExternalUrl(link.url, "preview-link").then((opened) => {
        // Opening wakes a stopped preview; pick up the new state.
        if (opened) refreshPreviewLinkStates(environmentId, [link.url]);
      });
    },
    [environmentId],
  );

  const remove = useCallback(
    async (link: ThreadPreviewLink) => {
      const result = await unlink({ environmentId, input: { threadId, url: link.url } });
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        Alert.alert(
          "Could not remove preview",
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "The preview link could not be removed.",
        );
      }
    },
    [environmentId, threadId, unlink],
  );

  const handleMenuEvent = useCallback(
    (
      event: string,
      links: ReadonlyArray<ThreadPreviewLink>,
      states: ReadonlyMap<string, ThreadPreviewLinkState>,
    ) => {
      const parsed = parsePreviewLinkMenuEvent(event, links);
      if (parsed === null) return;
      switch (parsed.intent) {
        case "open":
          open(parsed.link, states.get(parsed.link.url) ?? "unknown");
          return;
        case "open-external":
          openExternal(parsed.link);
          return;
        case "copy":
          copyTextWithHaptic(parsed.link.url);
          return;
        case "remove":
          void remove(parsed.link);
          return;
      }
    },
    [open, openExternal, remove],
  );

  return { open, openExternal, remove, handleMenuEvent };
}
