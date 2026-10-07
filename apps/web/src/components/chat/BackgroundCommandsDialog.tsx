import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  backgroundCommandStatusLabel,
  deriveBackgroundCommands,
  type BackgroundCommand,
  type BackgroundCommandStatus,
} from "@t3tools/client-runtime/state/background-commands";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { CheckIcon, CopyIcon, RadioTowerIcon, TerminalIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  type BackgroundCommandTarget,
  useBackgroundCommandsDialogStore,
} from "../../backgroundCommandsDialogStore";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { useThreadProjection } from "../../state/entities";
import { useBackgroundTaskOutput } from "../../state/queries";
import { Button } from "../ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";

/** Every background command and monitor a thread started, newest first. */
export function useBackgroundCommands(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
): ReadonlyArray<BackgroundCommand> {
  const projection =
    useThreadProjection(threadId === null ? null : scopeThreadRef(environmentId, threadId))
      ?.projection ?? null;
  return useMemo(
    () =>
      projection === null
        ? []
        : deriveBackgroundCommands({
            turnItems: projection.turnItems,
            pendingTasks: projection.providerThreads.flatMap(
              (thread) => thread.pendingBackgroundTasks ?? [],
            ),
          }),
    [projection],
  );
}

const STATUS_DOT_CLASS: Record<BackgroundCommandStatus, string> = {
  running: "bg-info",
  completed: "bg-success",
  failed: "bg-destructive",
  stopped: "bg-muted-foreground/60",
  ended: "bg-muted-foreground/60",
};

export function BackgroundCommandStatusDot(props: { readonly status: BackgroundCommandStatus }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT_CLASS[props.status])}
    />
  );
}

export function BackgroundCommandKindIcon(props: {
  readonly kind: BackgroundCommand["kind"];
  readonly className?: string;
}) {
  const Icon = props.kind === "monitor" ? RadioTowerIcon : TerminalIcon;
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", props.className)} />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CopyButton(props: { readonly value: string | null; readonly label: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: props.label });
  if (!props.value) return null;
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={`Copy ${props.label}`}
      onClick={() => copyToClipboard(props.value!, undefined)}
    >
      {isCopied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
    </Button>
  );
}

const codeBlockClass =
  "overflow-auto rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed whitespace-pre-wrap break-words select-text";

/**
 * A command that ended inside a turn gets no notification, so its exit code
 * comes from the exit line Claude appends to the output file.
 */
function withFileExit(
  command: BackgroundCommand,
  exitCode: number | undefined,
): Pick<BackgroundCommand, "status" | "exitCode"> {
  if (exitCode === undefined || command.status === "running" || command.status === "stopped") {
    return command;
  }
  return { status: exitCode === 0 ? "completed" : "failed", exitCode };
}

function BackgroundCommandDetail(props: {
  readonly target: BackgroundCommandTarget;
  readonly command: BackgroundCommand | undefined;
}) {
  const running = props.command?.status === "running";
  const query = useBackgroundTaskOutput(props.target, running);
  const result = query.data;
  const commandText = result?.command ?? props.command?.command ?? null;
  const output = result?.output ?? null;
  const status = props.command ? withFileExit(props.command, result?.exitCode) : null;

  // Follow new output while the reader is at the bottom; leave them be once they scroll up.
  const outputRef = useRef<HTMLPreElement>(null);
  const pinnedToBottom = useRef(true);
  useLayoutEffect(() => {
    const element = outputRef.current;
    if (element && output !== null && pinnedToBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [output]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
      <div className="flex min-w-0 items-center gap-2">
        <BackgroundCommandKindIcon
          kind={props.command?.kind ?? "command"}
          className="text-muted-foreground"
        />
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
          {props.command?.label ?? props.target.taskId}
        </h3>
        {status ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <BackgroundCommandStatusDot status={status.status} />
            {backgroundCommandStatusLabel(status)}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex h-6 items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            {props.command?.kind === "monitor" ? "Watching" : "Command"}
          </span>
          <CopyButton value={commandText} label="command" />
        </div>
        <pre className={cn(codeBlockClass, "max-h-36 text-foreground/90")}>
          {commandText ?? (query.isPending ? "Loading…" : "Command unavailable.")}
        </pre>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <div className="flex h-6 items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Output
            {result?.truncated ? (
              <span className="font-normal">
                {" "}
                · last 64 KB of {formatBytes(result.outputBytes)}
              </span>
            ) : null}
          </span>
          <CopyButton value={output} label="output" />
        </div>
        <pre
          ref={outputRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            pinnedToBottom.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 24;
          }}
          className={cn(codeBlockClass, "min-h-40 flex-1 text-muted-foreground")}
        >
          {output === null
            ? query.isPending && result === null
              ? "Loading…"
              : query.error
                ? `Couldn't read output: ${query.error}`
                : "No output file for this command."
            : output.length === 0
              ? running
                ? "No output yet."
                : "No output."
              : output}
        </pre>
      </div>
    </section>
  );
}

function BackgroundCommandsDialogContent(props: { readonly target: BackgroundCommandTarget }) {
  const { target } = props;
  const commands = useBackgroundCommands(target.environmentId, target.threadId);
  const [selectedTaskId, setSelectedTaskId] = useState(target.taskId);
  // A new open request from the bar or timeline wins over the last pick.
  const [openedTaskId, setOpenedTaskId] = useState(target.taskId);
  if (openedTaskId !== target.taskId) {
    setOpenedTaskId(target.taskId);
    setSelectedTaskId(target.taskId);
  }
  const selected = commands.find((command) => command.taskId === selectedTaskId);
  const runningCount = commands.filter((command) => command.status === "running").length;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Background commands</DialogTitle>
        <DialogDescription>
          {runningCount > 0
            ? `${runningCount} running, ${commands.length - runningCount} finished`
            : `${commands.length} finished`}
        </DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 border-t max-sm:flex-col">
        {commands.length > 1 ? (
          <ul
            aria-label="Background commands"
            className="m-0 flex shrink-0 list-none flex-col gap-0.5 overflow-y-auto p-2 max-sm:max-h-40 max-sm:border-b sm:w-60 sm:border-e"
          >
            {commands.map((command) => (
              <li key={command.taskId}>
                <button
                  type="button"
                  aria-current={command.taskId === selectedTaskId ? "true" : undefined}
                  onClick={() => setSelectedTaskId(command.taskId)}
                  className={cn(
                    "flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-black/[0.055] dark:hover:bg-white/[0.075]",
                    command.taskId === selectedTaskId &&
                      "bg-black/[0.055] text-foreground dark:bg-white/[0.075]",
                  )}
                >
                  <BackgroundCommandStatusDot status={command.status} />
                  <span className="min-w-0 flex-1 truncate text-foreground/85">
                    {command.label}
                  </span>
                  <BackgroundCommandKindIcon
                    kind={command.kind}
                    className="size-3 text-muted-foreground/70"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <BackgroundCommandDetail
          key={`${target.threadId}:${selectedTaskId}`}
          target={{ ...target, taskId: selectedTaskId }}
          command={selected}
        />
      </div>
    </>
  );
}

/** Shows what a background command or monitor runs and prints. Mounted once per chat view. */
export function BackgroundCommandsDialog() {
  const target = useBackgroundCommandsDialogStore((state) => state.target);
  const close = useBackgroundCommandsDialogStore((state) => state.close);
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogPopup className="h-[min(85vh,760px)] max-w-4xl">
        {target === null ? null : <BackgroundCommandsDialogContent target={target} />}
      </DialogPopup>
    </Dialog>
  );
}
