/**
 * The manager screen: a board of goals, their tasks and the worker threads on
 * them, next to the manager chat that runs the work.
 *
 * The board is drawn from durable state only: the goal and task files in each
 * profile's brain (the brainstorm state stream) and the live thread shells.
 * The manager is a real thread (All's brainstorm, hidden from the thread
 * lists) working in the default profile's brain; this view shows only its
 * messages and tool steps, and "Open as thread" leads to the full thread view.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentThreadShell,
  threadRuntimeIsActive,
} from "@t3tools/client-runtime/state/models";
import type {
  BrainstormOpenResult,
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

import { useBrainstormStore, useThreadShellsWithoutBrainstorms } from "../../brainstormStore";
import { isElectron } from "../../env";
import { cn, isMacPlatform, newMessageId } from "../../lib/utils";
import { ALL_SPACE_ID, useSpaceStore } from "../../spaceStore";
import { brainstormEnvironment } from "../../state/brainstorm";
import { usePrimaryEnvironmentId } from "../../state/environments";
import {
  useServerConfigs,
  useThreadShell,
  useThreadShells,
  useThreadVisibleTurnItems,
} from "../../state/entities";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { resolveThreadMetadataUpdateForNextTurn } from "../ChatView.logic";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  BRAINSTORM_MODELS,
  type BoardGoal,
  type BoardThreadStatus,
  INBOX_GOAL,
  boardGoals,
  boardThreadStatus,
  brainstormActivity,
  brainstormModelChoice,
  brainstormModelSelection,
  brainstormModelsOffered,
  brainstormSpacesInput,
  isBrainstormModelChoice,
  isBrainstormModelShortcut,
  needsYou,
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

export function ManagerScreen() {
  const environmentId = usePrimaryEnvironmentId();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {environmentId === null ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Spinner />
        </div>
      ) : (
        <ManagerContent environmentId={environmentId} />
      )}
    </SidebarInset>
  );
}

function ManagerContent(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const navigate = useNavigate();
  const state = useEnvironmentQuery(brainstormEnvironment.state({ environmentId, input: {} })).data;
  const syncSpaces = useAtomCommand(brainstormEnvironment.syncSpaces, { reportFailure: false });
  const openManager = useAtomCommand(brainstormEnvironment.open, { reportFailure: false });
  const [target, setTarget] = useState<BrainstormOpenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaultProfile = useBrainstormStore((store) => store.defaultProfile);
  const setDefaultProfile = useBrainstormStore((store) => store.setDefaultProfile);
  const spaces = useSpaceStore((store) => store.spaces);
  const [spaceFilter, setSpaceFilter] = useState(ALL_SPACE_ID);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // The server scopes by the spaces it knows; make sure it has them.
      await syncSpaces({
        environmentId,
        input: brainstormSpacesInput(useSpaceStore.getState(), environmentId, defaultProfile),
      });
      // The manager is All's chat.
      const result = await openManager({ environmentId, input: { spaceId: ALL_SPACE_ID } });
      if (cancelled) return;
      if (result._tag === "Success") setTarget(result.value);
      else setError(formatEnvironmentQueryError(result.cause));
    })();
    return () => {
      cancelled = true;
    };
  }, [defaultProfile, environmentId, openManager, syncSpaces]);

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
  // Toggling moves an idle thread right away, so "Open as thread" shows the
  // model the next turn will use.
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

  const openThread = useCallback(
    (threadId: string) =>
      void navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } }),
    [environmentId, navigate],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
      <WorkspacePageHeader electron={isElectron} className="border-b border-border">
        <h1 className="font-medium text-sm">Manager</h1>
        <Select
          value={spaceFilter}
          onValueChange={(value) => {
            if (typeof value === "string" && value) setSpaceFilter(value);
          }}
        >
          <SelectTrigger size="xs" className="w-auto" aria-label="Space">
            <SelectValue>
              {spaces.find((space) => space.id === spaceFilter)?.name ?? "All"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {spaces.map((space) => (
              <SelectItem key={space.id} hideIndicator value={space.id}>
                {space.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {(state?.profiles.length ?? 0) > 1 ? (
          <Select
            value={state?.defaultProfile ?? ""}
            onValueChange={(value) => {
              if (typeof value === "string" && value) setDefaultProfile(value);
            }}
          >
            <SelectTrigger size="xs" className="w-auto" aria-label="Manager's brain">
              <SelectValue>{`${state?.defaultProfile ?? "?"}-brain`}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              {(state?.profiles ?? []).map((profile) => (
                <SelectItem key={profile} hideIndicator value={profile}>
                  {`${profile}-brain`}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        <div className="ms-auto flex items-center gap-1">
          {modelsOffered && threadKey !== null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroup
                    aria-label="Manager model"
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
          <Button
            size="compact"
            variant="ghost-muted"
            disabled={!target}
            onClick={() => target && openThread(target.threadId)}
          >
            <ExternalLinkIcon />
            Open as thread
          </Button>
        </div>
      </WorkspacePageHeader>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] max-md:grid-cols-1 max-md:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
        <ManagerBoard
          environmentId={environmentId}
          spaceId={spaceFilter}
          lists={state?.taskLists ?? []}
          onOpenThread={openThread}
        />
        <section
          className="flex min-h-0 flex-col border-s max-md:border-s-0 max-md:border-t"
          aria-label="Manager chat"
        >
          {error ? (
            <div className="m-4 rounded-md border border-destructive/30 p-3 text-destructive-foreground text-sm">
              {error}
            </div>
          ) : threadRef === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Spinner />
            </div>
          ) : (
            <ManagerChat
              environmentId={environmentId}
              threadId={threadRef.threadId}
              modelSelection={modelSelection}
              cwd={target?.brainPath}
              onOpenAsThread={() => target && openThread(target.threadId)}
            />
          )}
        </section>
      </div>
    </div>
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

function ManagerChat(props: {
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
            Tell the manager what you want done. It plans the tasks, starts worker threads and asks
            you only for real decisions.
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
            aria-label="Message the manager"
            className="max-h-40 min-h-9 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Message the manager… (Enter to send)"
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

/** The manager chat: user and assistant messages, with one line per tool call. */
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

const STATUS_LOOK: Readonly<Record<BoardThreadStatus, { label: string; dot: string }>> = {
  "needs-approval": { label: "needs approval", dot: "bg-amber-500" },
  "needs-input": { label: "needs input", dot: "bg-amber-500" },
  failed: { label: "failed", dot: "bg-destructive" },
  working: { label: "working", dot: "bg-sky-500" },
  finished: { label: "finished", dot: "bg-emerald-500/60" },
  settled: { label: "settled", dot: "bg-emerald-500" },
  archived: { label: "archived", dot: "bg-muted-foreground/40" },
  idle: { label: "idle", dot: "bg-muted-foreground/60" },
  gone: { label: "gone", dot: "bg-muted-foreground/40" },
};

function ManagerBoard(props: {
  readonly environmentId: EnvironmentId;
  readonly spaceId: string;
  readonly lists: ReadonlyArray<BrainstormTaskList>;
  readonly onOpenThread: (threadId: string) => void;
}) {
  const mutate = useAtomCommand(brainstormEnvironment.mutateTasks, "Update task");
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);
  // Linked threads stay findable when they are archived or settled.
  const allThreads = useThreadShells();
  const workThreads = useThreadShellsWithoutBrainstorms();
  // Everything waiting on the user, whatever the space filter.
  const waiting = useMemo(
    () => needsYou(workThreads.filter((thread) => thread.environmentId === props.environmentId)),
    [props.environmentId, workThreads],
  );
  const goals = useMemo(
    () => boardGoals(props.lists, props.spaceId, showDone),
    [props.lists, props.spaceId, showDone],
  );

  const run = (spaceId: string, mutation: Parameters<typeof mutate>[0]["input"]["mutation"]) =>
    void mutate({ environmentId: props.environmentId, input: { spaceId, mutation } });

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    run(props.spaceId, { type: "add", title });
    setDraft("");
  };

  return (
    <div className="min-h-0 overflow-y-auto px-4 py-3" aria-label="Board">
      <section aria-label="Needs you" className="mb-4">
        <h2 className="mb-1.5 font-medium text-muted-foreground text-xs">
          Needs you{waiting.length > 0 ? ` · ${waiting.length}` : ""}
        </h2>
        {waiting.length === 0 ? (
          <p className="text-muted-foreground text-xs">Nothing is waiting on you.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {waiting.map((thread) => (
              <li key={thread.id}>
                <ThreadChip thread={thread} onOpen={() => props.onOpenThread(thread.id)} wide />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Goals">
        <div className="mb-1.5 flex items-center gap-2">
          <h2 className="font-medium text-muted-foreground text-xs">Goals</h2>
          <label className="ms-auto flex items-center gap-1.5 text-muted-foreground text-xs">
            <Checkbox
              checked={showDone}
              onCheckedChange={(checked) => setShowDone(checked === true)}
            />
            Show done
          </label>
        </div>
        <form
          className="mb-3 flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            aria-label="New task"
            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Add a task to the Inbox… (ask the manager for a new goal)"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button size="icon-sm" variant="ghost" type="submit" aria-label="Add task">
            <PlusIcon />
          </Button>
        </form>
        {goals.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground text-xs">
            No goals yet. Tell the manager what you want done.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {goals.map((goal) => (
              <GoalCard
                key={goal.key}
                goal={goal}
                showSpace={props.spaceId === ALL_SPACE_ID}
                threads={allThreads}
                onToggleGoal={(done) =>
                  run(goal.spaceId, { type: "set-goal-done", goal: goal.title, done })
                }
                onToggleTask={(task, done) =>
                  run(goal.spaceId, {
                    type: "set-done",
                    number: task.number,
                    title: task.title,
                    done,
                  })
                }
                onDeleteTask={(task) =>
                  run(goal.spaceId, { type: "delete", number: task.number, title: task.title })
                }
                onOpenThread={props.onOpenThread}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function GoalCard(props: {
  readonly goal: BoardGoal;
  readonly showSpace: boolean;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly onToggleGoal: (done: boolean) => void;
  readonly onToggleTask: (task: BrainstormTask, done: boolean) => void;
  readonly onDeleteTask: (task: BrainstormTask) => void;
  readonly onOpenThread: (threadId: string) => void;
}) {
  const { goal } = props;
  const isInbox = goal.title === INBOX_GOAL;
  const doneCount = goal.tasks.filter((task) => task.done).length;
  return (
    <article className="rounded-lg border px-3 py-2" data-goal={goal.title}>
      <header className="flex items-center gap-2">
        {isInbox ? null : (
          <Checkbox
            checked={goal.done}
            onCheckedChange={(checked) => props.onToggleGoal(checked === true)}
            aria-label={goal.done ? `Reopen goal ${goal.title}` : `Complete goal ${goal.title}`}
          />
        )}
        <h3
          className={cn(
            "min-w-0 flex-1 truncate font-medium text-sm",
            goal.done && "text-muted-foreground line-through",
          )}
        >
          {goal.title}
        </h3>
        {props.showSpace ? (
          <span className="shrink-0 text-muted-foreground text-xs">{goal.spaceName}</span>
        ) : null}
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {doneCount}/{goal.tasks.length}
        </span>
      </header>
      {goal.notes.length > 0 ? (
        <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{goal.notes.join(" ")}</p>
      ) : null}
      {goal.tasks.length > 0 ? (
        <ul className="mt-1.5">
          {goal.tasks.map((task) => (
            <TaskRow
              key={`${task.number}:${task.title}`}
              task={task}
              threads={props.threads}
              onToggle={(done) => props.onToggleTask(task, done)}
              onDelete={() => props.onDeleteTask(task)}
              onOpenThread={props.onOpenThread}
            />
          ))}
        </ul>
      ) : null}
    </article>
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
          {task.title}
        </p>
        {task.threadIds.length > 0 ? (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {task.threadIds.map((threadId) => (
              <ThreadChip
                key={threadId}
                thread={props.threads.find((candidate) => candidate.id === threadId)}
                onOpen={() => props.onOpenThread(threadId)}
              />
            ))}
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

/** A worker thread with its live status and the pull requests it links. */
function ThreadChip(props: {
  readonly thread: EnvironmentThreadShell | undefined;
  readonly onOpen: () => void;
  readonly wide?: boolean;
}) {
  const { thread } = props;
  const status = STATUS_LOOK[boardThreadStatus(thread)];
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded border px-1 text-2xs text-muted-foreground",
        props.wide && "flex w-full py-0.5 text-xs",
      )}
    >
      <button
        type="button"
        className="inline-flex min-w-0 items-center gap-1 hover:text-foreground"
        onClick={props.onOpen}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} />
        <span className="truncate">{thread?.title ?? "thread"}</span>
        <span className="shrink-0">· {status.label}</span>
      </button>
      {(thread?.pullRequests ?? []).map((pullRequest) => (
        <a
          key={`${pullRequest.repository}#${pullRequest.number}`}
          className="shrink-0 hover:text-foreground"
          href={pullRequest.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          #{pullRequest.number}
          {pullRequest.snapshot ? ` ${pullRequest.snapshot.state}` : ""}
        </a>
      ))}
    </span>
  );
}
