/**
 * The thread's working facts at the end of a Grow item's story: its branch and Open in the
 * editor, then (folded) its automations and lineage. The same rows and sections as the thread
 * details panel, so the item never has to be left to see where the work lives.
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { projectScriptCwd } from "@t3tools/shared/projectScripts";
import { useAtomValue } from "@effect/atom-react";
import { CheckIcon, ChevronDownIcon, CopyIcon, GitBranchIcon } from "lucide-react";
import { useState } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { useRemoteOpenState } from "../../remoteOpen";
import { usePrimaryEnvironment } from "../../state/environments";
import { useProjects } from "../../state/entities";
import {
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
} from "../../state/server";
import { OpenInPicker } from "../chat/OpenInPicker";
import { shouldShowOpenInPicker } from "../chat/OpenInPicker.logic";
import { ThreadAutomationsPanel } from "../chat/ThreadAutomationsPanel";
import { ThreadRelationshipsPanel } from "../chat/ThreadRelationshipsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_ROW_CLASS,
} from "../chat/threadDetailsPanelStyles";
import type { GrowReturn } from "./returns.logic";

export function GrowDetails(props: { readonly item: GrowReturn }) {
  const { thread } = props.item;
  const [more, setMore] = useState(false);
  return (
    <section aria-labelledby="grow-details-heading" className="flex flex-col gap-1">
      <h3 id="grow-details-heading" className="font-medium text-muted-foreground text-xs">
        Details
      </h3>
      <div className="-mx-2.5 flex flex-col">
        <BranchRow thread={thread} />
        <OpenInRow thread={thread} />
        <button
          type="button"
          aria-expanded={more}
          className="mt-1 flex items-center gap-1 rounded px-2.5 py-1 text-start text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setMore(!more)}
        >
          <ChevronDownIcon className={cn("size-3.5 transition-transform", !more && "-rotate-90")} />
          Automations and lineage
        </button>
        {more ? (
          <div className="-mx-2">
            <ThreadAutomationsPanel environmentId={thread.environmentId} threadId={thread.id} />
            <ThreadRelationshipsPanel environmentId={thread.environmentId} threadId={thread.id} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The branch, copied on click, since that is what a branch name is for outside its tools. */
function BranchRow(props: { readonly thread: EnvironmentThreadShell }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "branch name" });
  const { branch } = props.thread;
  if (!branch) return null;
  return (
    <button
      type="button"
      aria-label={`Copy branch name ${branch}`}
      className={cn(THREAD_DETAILS_PANEL_ROW_CLASS, "group/branch flex items-center")}
      onClick={() => copyToClipboard(branch, undefined)}
    >
      <GitBranchIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
      <span className="min-w-0 flex-1 truncate">{branch}</span>
      {isCopied ? (
        <CheckIcon className={cn(THREAD_DETAILS_PANEL_ICON_CLASS, "text-success")} />
      ) : (
        <CopyIcon
          className={cn(
            THREAD_DETAILS_PANEL_ICON_CLASS,
            "opacity-0 group-hover/branch:opacity-100 group-focus-visible/branch:opacity-100",
          )}
        />
      )}
    </button>
  );
}

/** Open the thread's checkout in the editor, as the thread details panel does. */
function OpenInRow(props: { readonly thread: EnvironmentThreadShell }) {
  const { thread } = props;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const primary = usePrimaryEnvironment();
  const remoteOpen = useRemoteOpenState(thread.environmentId);
  const project = useProjects().find(
    (candidate) =>
      candidate.environmentId === thread.environmentId && candidate.id === thread.projectId,
  );
  if (
    !project ||
    !shouldShowOpenInPicker({
      activeProjectName: project.title,
      activeThreadEnvironmentId: thread.environmentId,
      primaryEnvironmentId: primary?.environmentId ?? null,
      remoteOpenMode: remoteOpen.mode,
    })
  ) {
    return null;
  }
  return (
    <OpenInPicker
      environmentId={thread.environmentId}
      keybindings={keybindings}
      availableEditors={availableEditors}
      openInCwd={projectScriptCwd({
        project: { cwd: project.workspaceRoot },
        worktreePath: thread.worktreePath,
      })}
      enableShortcut={false}
      displayMode="panel"
    />
  );
}
