import type { ContextMenuItem } from "@t3tools/contracts";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";

import { toastManager } from "../ui/toast";

type ThreadPreviewLinkContextMenuAction = "open" | "open-external" | "copy-link" | "remove";

const items: readonly ContextMenuItem<ThreadPreviewLinkContextMenuAction>[] = [
  { id: "open", label: "Open" },
  { id: "open-external", label: "Open in system browser" },
  { id: "copy-link", label: "Copy link", icon: "copy" },
  { id: "remove", label: "Remove", destructive: true, separatorBefore: true },
];

/** The right-click on a preview chip: the ways in, plus the way out (Remove unlinks it). */
export async function showThreadPreviewLinkContextMenu({
  url,
  position,
  onOpen,
  onRemove,
}: {
  readonly url: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly onOpen: () => void;
  readonly onRemove: () => void;
}): Promise<void> {
  const api = readLocalApi();
  if (!api) return;
  let action: ThreadPreviewLinkContextMenuAction | null = null;
  try {
    action = await api.contextMenu.show(items, position);
  } catch {
    return;
  }
  if (action === "open") onOpen();
  else if (action === "remove") onRemove();
  else if (action === "copy-link" || action === "open-external") {
    try {
      if (action === "copy-link") await writeTextToClipboard(url, "link");
      else await api.shell.openExternal(url);
    } catch {
      toastManager.add({
        type: "error",
        title: action === "copy-link" ? "Could not copy the link" : "Could not open the link",
      });
    }
  }
}
