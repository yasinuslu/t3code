/**
 * The brainstorm popup: a Spotlight-style chat with the active space's
 * brainstorm agent, next to that space's task list.
 *
 * The chat is a real thread (hidden from the thread lists) working in the
 * space's brain repository; this view shows only its messages and tool
 * steps, and "Open as thread" leads to the full thread view.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentThreadShell,
  threadRuntimeIsActive,
} from "@t3tools/client-runtime/state/models";
import type {
  BrainstormOpenResult,
  BrainstormState,
  BrainstormTask,
  BrainstormTaskList,
  EnvironmentId,
  ModelSelection,
  OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useBrainstormStore } from "../../brainstormStore";
import { cn, isMacPlatform, newMessageId } from "../../lib/utils";
import { ALL_SPACE_ID, useSpaceStore } from "../../spaceStore";
import { brainstormEnvironment } from "../../state/brainstorm";
import {
  useServerConfigs,
  useThreadShell,
  useThreadShells,
  useThreadVisibleTurnItems,
} from "../../state/entities";
import { formatEnvironmentQueryError } from "../../state/query";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { resolveThreadMetadataUpdateForNextTurn } from "../ChatView.logic";
import { SpaceIcon } from "../sidebar/SpaceSwitcher";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogPopup } from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  BRAINSTORM_MODELS,
  brainstormActivity,
  brainstormModelChoice,
  brainstormModelSelection,
  brainstormModelsOffered,
  brainstormSpacesInput,
  isBrainstormModelChoice,
  isBrainstormModelShortcut,
  otherBrainstormModel,
  toolStepsOf,
} from "./brainstorm.logic";

const IS_MAC = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
const MODEL_SHORTCUT_LABEL = IS_MAC ? "⌘/" : "Ctrl+/";

/**
 * Put the thread on a model selection before its next turn, the way the
 * composer does; resolves to an error message, or null when done.
 */
function usePersistModelSelection(environmentId: EnvironmentId) {
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  return useCallback(
    async (
      shell: Pick<EnvironmentThreadShell, "id" | "modelSelection" | "branch">,
      next: ModelSelection,
    ): Promise<string | null> => {
      const update = resolveThreadMetadataUpdateForNextTurn({
        currentModelSelection: shell.modelSelection,
        nextModelSelection: next,
        currentBranch: shell.branch,
      });
      if (!update) return null;
      const result = await updateMetadata({
        environmentId,
        input: { threadId: shell.id, ...update },
      });
      return result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null;
    },
    [environmentId, updateMetadata],
  );
}

export function BrainstormPopup(props: {
  readonly environmentId: EnvironmentId;
  readonly state: BrainstormState | null;
}) {
  const open = useBrainstormStore((store) => store.open);
  const spaceId = useBrainstormStore((store) => store.spaceId);
  const close = useBrainstormStore((store) => store.close);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogPopup
        aria-label="Brainstorm"
        bottomStickOnMobile={false}
        className="h-[min(44rem,calc(100dvh-4rem))] w-[min(62rem,calc(100vw-2rem))] max-w-none overflow-hidden"
        data-brainstorm-popup="true"
        showCloseButton={false}
      >
        {spaceId !== null ? (
          <BrainstormContent
            key={spaceId}
            environmentId={props.environmentId}
            spaceId={spaceId}
            state={props.state}
            onClose={close}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function BrainstormContent(props: {
  readonly environmentId: EnvironmentId;
  readonly spaceId: string;
  readonly state: BrainstormState | null;
  readonly onClose: () => void;
}) {
  const { environmentId, spaceId } = props;
  const space = useSpaceStore((store) => store.spaces.find((entry) => entry.id === spaceId));
  const navigate = useNavigate();
  const syncSpaces = useAtomCommand(brainstormEnvironment.syncSpaces, { reportFailure: false });
  const openBrainstorm = useAtomCommand(brainstormEnvironment.open, { reportFailure: false });
  const [target, setTarget] = useState<BrainstormOpenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaultProfile = useBrainstormStore((store) => store.defaultProfile);
  const setDefaultProfile = useBrainstormStore((store) => store.setDefaultProfile);
  const usesDefaultBrain = space !== undefined && space.profile === null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // The server scopes by the spaces it knows; make sure it has this one.
      await syncSpaces({
        environmentId,
        input: brainstormSpacesInput(useSpaceStore.getState(), environmentId, defaultProfile),
      });
      const result = await openBrainstorm({ environmentId, input: { spaceId } });
      if (cancelled) return;
      if (result._tag === "Success") setTarget(result.value);
      else setError(formatEnvironmentQueryError(result.cause));
    })();
    return () => {
      cancelled = true;
    };
  }, [defaultProfile, environmentId, openBrainstorm, spaceId, syncSpaces]);

  // Esc always dismisses, even when a focused field or a global handler
  // claims the key before the dialog sees it.
  const { onClose } = props;
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      if (document.querySelector("[data-slot='select-popup']")) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const threadRef = useMemo(
    () => (target ? scopeThreadRef(environmentId, target.threadId) : null),
    [environmentId, target],
  );
  const threadKey = target ? `${environmentId}:${target.threadId}` : null;
  const shell = useThreadShell(threadRef);
  const serverConfig = useServerConfigs().get(environmentId);
  const modelsOffered = brainstormModelsOffered(
    serverConfig?.providers.find(
      (provider) => provider.instanceId === shell?.modelSelection.instanceId,
    )?.models,
  );
  const storedModelChoice = useBrainstormStore((store) =>
    threadKey ? store.modelChoiceByThreadKey[threadKey] : undefined,
  );
  const setModelChoice = useBrainstormStore((store) => store.setModelChoice);
  const modelChoice = brainstormModelChoice(storedModelChoice);
  // Only a Claude instance that offers both models is switched; others keep theirs.
  const modelSelection = useMemo(
    () =>
      shell === null
        ? null
        : modelsOffered
          ? brainstormModelSelection(shell.modelSelection, modelChoice)
          : shell.modelSelection,
    [modelChoice, modelsOffered, shell],
  );
  const persistModelSelection = usePersistModelSelection(environmentId);
  const threadBusy = threadRuntimeIsActive(shell?.runtime);
  // Opening or toggling moves an idle thread right away, so "Open as thread"
  // shows the model the next turn will use.
  const persistedModelRef = useRef<string | null>(null);
  useEffect(() => {
    if (shell === null || modelSelection === null || threadBusy) return;
    if (modelSelection === shell.modelSelection) return;
    const key = `${shell.id}:${modelSelection.model}`;
    if (persistedModelRef.current === key) return;
    persistedModelRef.current = key;
    void persistModelSelection(shell, modelSelection);
  }, [modelSelection, persistModelSelection, shell, threadBusy]);

  const flipModel = useCallback(() => {
    if (threadKey === null || !modelsOffered) return;
    setModelChoice(threadKey, otherBrainstormModel(modelChoice));
  }, [modelChoice, modelsOffered, setModelChoice, threadKey]);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isBrainstormModelShortcut(event, IS_MAC)) return;
      event.preventDefault();
      event.stopPropagation();
      flipModel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [flipModel]);

  const openAsThread = () => {
    if (!target) return;
    props.onClose();
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: target.threadId },
    });
  };

  return (
    <>
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        {space ? <SpaceIcon icon={space.icon} className="size-4" /> : null}
        <h2 className="font-medium text-sm">Brainstorm · {space?.name ?? "Space"}</h2>
        {usesDefaultBrain && (props.state?.profiles.length ?? 0) > 1 ? (
          <Select
            value={props.state?.defaultProfile ?? ""}
            onValueChange={(value) => {
              if (typeof value === "string" && value) setDefaultProfile(value);
            }}
          >
            <SelectTrigger size="xs" className="w-auto" aria-label="Brain for this space">
              <SelectValue>{`${props.state?.defaultProfile ?? "?"}-brain`}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              {(props.state?.profiles ?? []).map((profile) => (
                <SelectItem key={profile} hideIndicator value={profile}>
                  {`${profile}-brain`}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        {target ? (
          <span className="truncate text-muted-foreground text-xs">{target.brainPath}</span>
        ) : null}
        <div className="ms-auto flex items-center gap-1">
          {modelsOffered && threadKey !== null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroup
                    aria-label="Brainstorm model"
                    data-brainstorm-model={modelChoice}
                    value={[modelChoice]}
                    onValueChange={(value) => {
                      const next = value[0];
                      if (isBrainstormModelChoice(next)) setModelChoice(threadKey, next);
                    }}
                  />
                }
              >
                {(["sonnet", "opus"] as const).map((choice) => (
                  <Toggle key={choice} value={choice}>
                    {BRAINSTORM_MODELS[choice].label}
                  </Toggle>
                ))}
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                Model for the next turn · {MODEL_SHORTCUT_LABEL} to switch
              </TooltipPopup>
            </Tooltip>
          ) : null}
          <Button size="compact" variant="ghost-muted" disabled={!target} onClick={openAsThread}>
            <ExternalLinkIcon />
            Open as thread
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={props.onClose}>
            <XIcon />
          </Button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_17rem] max-sm:grid-cols-1">
        <section className="flex min-h-0 flex-col" aria-label="Chat">
          {error ? (
            <div className="m-4 rounded-md border border-destructive/30 p-3 text-destructive-foreground text-sm">
              {error}
            </div>
          ) : threadRef === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Spinner />
            </div>
          ) : (
            <BrainstormChat
              environmentId={environmentId}
              threadId={threadRef.threadId}
              modelSelection={modelSelection}
              cwd={target?.brainPath}
              onOpenAsThread={openAsThread}
            />
          )}
        </section>
        <BrainstormTasks
          environmentId={environmentId}
          spaceId={spaceId}
          lists={props.state?.taskLists ?? []}
          onOpenThread={(threadId) => {
            props.onClose();
            void navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });
          }}
        />
      </div>
    </>
  );
}

type TimelineEntry =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly role: string;
      readonly text: string;
      readonly streaming: boolean;
      readonly at: string;
    }
  | { readonly kind: "step"; readonly id: string; readonly text: string; readonly at: string };

function BrainstormChat(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: EnvironmentThreadShell["id"];
  readonly modelSelection: ModelSelection | null;
  readonly cwd: string | undefined;
  readonly onOpenAsThread: () => void;
}) {
  const ref = useMemo(
    () => scopeThreadRef(props.environmentId, props.threadId),
    [props.environmentId, props.threadId],
  );
  const shell = useThreadShell(ref);
  const items = useThreadVisibleTurnItems(ref);
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn);
  const persistModelSelection = usePersistModelSelection(props.environmentId);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [awaitingSince, setAwaitingSince] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastAnswerAt = useMemo(() => {
    const answer = items.findLast(
      (entry) => entry.item.type === "assistant_message" && !entry.item.streaming,
    );
    return answer ? DateTime.formatIso(answer.item.updatedAt) : null;
  }, [items]);
  const activity = brainstormActivity({
    runStatus: shell?.runtime?.status ?? null,
    lastError: shell?.runtime?.lastError ?? null,
    hasPendingApprovals: shell?.hasPendingApprovals ?? false,
    hasPendingUserInput: shell?.hasPendingUserInput ?? false,
    awaitingSince,
    lastAnswerAt,
  });
  const running = activity.kind === "thinking";

  const timeline = useMemo<ReadonlyArray<TimelineEntry>>(
    () => timelineOf(items, running),
    [items, running],
  );

  useLayoutEffect(() => {
    const element = scrollRef.current;
    // Follow the conversation as it grows.
    if (element && timeline.length > 0) element.scrollTop = element.scrollHeight;
  }, [timeline]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 || !shell || sending) return;
    setSending(true);
    setSendError(null);
    setAwaitingSince(new Date().toISOString());
    const modelSelection = props.modelSelection ?? shell.modelSelection;
    const modelError = await persistModelSelection(shell, modelSelection);
    if (modelError !== null) {
      setSending(false);
      setAwaitingSince(null);
      setSendError(modelError);
      return;
    }
    const result = await startTurn({
      environmentId: props.environmentId,
      input: {
        threadId: props.threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        modelSelection,
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
      },
    });
    setSending(false);
    if (result._tag === "Failure") {
      setAwaitingSince(null);
      setSendError(formatEnvironmentQueryError(result.cause));
      return;
    }
    setDraft("");
  }, [
    draft,
    persistModelSelection,
    props.environmentId,
    props.modelSelection,
    props.threadId,
    sending,
    shell,
    startTurn,
  ]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {timeline.length === 0 ? (
          <p className="mt-10 text-center text-muted-foreground text-sm">
            Ask what is going on, add a task, or start a thread from one.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {timeline.map((entry) =>
              entry.kind === "step" ? (
                <li
                  key={entry.id}
                  className="truncate ps-1 font-mono text-muted-foreground text-xs"
                >
                  {entry.text}
                </li>
              ) : entry.role === "user" ? (
                <li
                  key={entry.id}
                  className="ms-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-accent px-3 py-2 text-sm"
                >
                  {entry.text}
                </li>
              ) : (
                <li key={entry.id} className="text-sm">
                  <ChatMarkdown text={entry.text} cwd={props.cwd} isStreaming={entry.streaming} />
                </li>
              ),
            )}
          </ol>
        )}
        {activity.kind === "thinking" ? (
          <div
            className="mt-3 flex items-center gap-2 text-muted-foreground text-sm"
            data-brainstorm-activity="thinking"
          >
            <Spinner className="size-3.5" /> Thinking…
          </div>
        ) : activity.kind === "needs-input" ? (
          <div
            className="mt-3 flex items-center gap-2 rounded-md border border-warning/40 bg-warning-surface px-3 py-2 text-sm"
            data-brainstorm-activity="needs-input"
          >
            <span className="flex-1">
              {activity.what === "approval"
                ? "The agent is waiting for your approval."
                : "The agent asked you a question."}
            </span>
            <Button size="compact" variant="outline" onClick={props.onOpenAsThread}>
              Open as thread
            </Button>
          </div>
        ) : activity.kind === "error" ? (
          <div
            className="mt-3 rounded-md border border-destructive/30 px-3 py-2 text-destructive-foreground text-sm"
            data-brainstorm-activity="error"
          >
            {activity.message}
          </div>
        ) : null}
      </div>
      <div className="border-t p-3">
        {sendError ? <p className="mb-2 text-destructive-foreground text-xs">{sendError}</p> : null}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            aria-label="Message the brainstorm"
            className="max-h-40 min-h-9 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Brainstorm… (Enter to send, Esc to close)"
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {threadRuntimeIsActive(shell?.runtime) ? (
            <Button
              size="icon"
              variant="outline"
              aria-label="Stop"
              onClick={() =>
                void interruptTurn({
                  environmentId: props.environmentId,
                  input: { threadId: props.threadId },
                })
              }
            >
              <SquareIcon />
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** The popup's chat: user and assistant messages, with one line per tool call. */
function timelineOf(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  running: boolean,
): ReadonlyArray<TimelineEntry> {
  const entries: TimelineEntry[] = [];
  const toolItems = [];
  for (const { item } of items) {
    const at = DateTime.formatIso(item.startedAt ?? item.updatedAt);
    if (item.type === "user_message" || item.type === "assistant_message") {
      entries.push({
        kind: "message",
        id: item.id,
        role: item.type === "user_message" ? "user" : "assistant",
        text: item.text,
        streaming: item.type === "assistant_message" && item.streaming,
        at,
      });
    } else {
      toolItems.push({
        id: item.id,
        type: item.type,
        status: item.status,
        title: item.title,
        ...(item.type === "dynamic_tool" ? { toolName: item.toolName, input: item.input } : {}),
        ...(item.type === "command_execution" ? { input: item.input } : {}),
        at,
      });
    }
  }
  for (const step of toolStepsOf(toolItems)) {
    entries.push({
      kind: "step",
      id: step.id,
      text: step.done || !running ? step.label : `${step.label} …`,
      at: step.at,
    });
  }
  // Items arrive in timeline order; a stable sort by time keeps ties in place.
  return entries.toSorted((left, right) => left.at.localeCompare(right.at));
}

function linkedThreadStatus(thread: EnvironmentThreadShell | undefined): {
  readonly label: string;
  readonly className: string;
} {
  if (!thread) return { label: "gone", className: "bg-muted-foreground/40" };
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
    return { label: "waiting on you", className: "bg-amber-500" };
  }
  if (threadRuntimeIsActive(thread.runtime)) {
    return { label: "working", className: "bg-sky-500" };
  }
  if (thread.settledOverride === "settled")
    return { label: "settled", className: "bg-emerald-500" };
  const status = thread.runtime?.status ?? thread.latestRun?.status;
  if (status === "completed") return { label: "finished", className: "bg-emerald-500/60" };
  if (status === "failed") return { label: "failed", className: "bg-destructive" };
  return { label: "idle", className: "bg-muted-foreground/60" };
}

function BrainstormTasks(props: {
  readonly environmentId: EnvironmentId;
  readonly spaceId: string;
  readonly lists: ReadonlyArray<BrainstormTaskList>;
  readonly onOpenThread: (threadId: string) => void;
}) {
  const mutate = useAtomCommand(brainstormEnvironment.mutateTasks, "Update task");
  const [draft, setDraft] = useState("");
  const threads = useThreadShells();
  const isAll = props.spaceId === ALL_SPACE_ID;
  const lists = isAll
    ? props.lists.filter((list) => list.tasks.length > 0)
    : props.lists.filter((list) => list.spaceId === props.spaceId);
  const ownPath = isAll ? null : (lists[0]?.path ?? null);

  const run = (spaceId: string, mutation: Parameters<typeof mutate>[0]["input"]["mutation"]) =>
    void mutate({ environmentId: props.environmentId, input: { spaceId, mutation } });

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    run(props.spaceId, { type: "add", title });
    setDraft("");
  };

  return (
    <aside
      className="flex min-h-0 flex-col border-s max-sm:border-s-0 max-sm:border-t"
      aria-label="Tasks"
    >
      <div className="flex items-baseline justify-between px-3 pt-3 pb-2">
        <h3 className="font-medium text-sm">Tasks</h3>
        {ownPath ? (
          <span className="truncate ps-2 text-muted-foreground text-xs">
            {ownPath.split("/").slice(-2).join("/")}
          </span>
        ) : null}
      </div>
      <form
        className="flex items-center gap-1 px-3 pb-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          aria-label="New task"
          className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={isAll ? "Add a task (default space)…" : "Add a task…"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button size="icon-sm" variant="ghost" type="submit" aria-label="Add task">
          <PlusIcon />
        </Button>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {lists.every((list) => list.tasks.length === 0) ? (
          <p className="px-1 py-4 text-center text-muted-foreground text-xs">No tasks yet.</p>
        ) : (
          lists.map((list) => (
            <section key={list.spaceId} className="mb-2">
              {isAll ? (
                <h4 className="px-1 pt-1 pb-0.5 font-medium text-muted-foreground text-xs">
                  {list.spaceName}
                </h4>
              ) : null}
              <ul>
                {[
                  ...list.tasks.filter((task) => !task.done),
                  ...list.tasks.filter((task) => task.done),
                ].map((task) => (
                  <TaskRow
                    key={`${task.number}:${task.title}`}
                    task={task}
                    threads={threads}
                    onToggle={(done) =>
                      run(list.spaceId, {
                        type: "set-done",
                        number: task.number,
                        title: task.title,
                        done,
                      })
                    }
                    onDelete={() =>
                      run(list.spaceId, { type: "delete", number: task.number, title: task.title })
                    }
                    onOpenThread={props.onOpenThread}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}

function TaskRow(props: {
  readonly task: BrainstormTask;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly onToggle: (done: boolean) => void;
  readonly onDelete: () => void;
  readonly onOpenThread: (threadId: string) => void;
}) {
  const { task } = props;
  return (
    <li className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-accent/50">
      <Checkbox
        className="mt-0.5"
        checked={task.done}
        onCheckedChange={(checked) => props.onToggle(checked === true)}
        aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}
      />
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs leading-5", task.done && "text-muted-foreground line-through")}>
          <span className="text-muted-foreground">{task.number}. </span>
          {task.title}
        </p>
        {task.threadIds.length > 0 ? (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {task.threadIds.map((threadId) => {
              const thread = props.threads.find((candidate) => candidate.id === threadId);
              const status = linkedThreadStatus(thread);
              return (
                <button
                  key={threadId}
                  type="button"
                  className="inline-flex max-w-full items-center gap-1 rounded border px-1 text-2xs text-muted-foreground hover:text-foreground"
                  onClick={() => props.onOpenThread(threadId)}
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full", status.className)} />
                  <span className="truncate">{thread?.title ?? "thread"}</span>
                  <span>· {status.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <span className="opacity-0 focus-within:opacity-100 group-hover:opacity-100">
        <Button
          size="icon-micro"
          variant="ghost-destructive"
          aria-label={`Delete ${task.title}`}
          onClick={props.onDelete}
        >
          <XIcon />
        </Button>
      </span>
    </li>
  );
}
