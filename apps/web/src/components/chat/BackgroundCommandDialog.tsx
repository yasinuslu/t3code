import {
  backgroundCommandStatusLabel,
  type BackgroundCommand,
} from "@t3tools/client-runtime/state/background-commands";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { TERMINAL_PALETTES, terminalOutputSpans } from "@t3tools/shared/terminalOutput";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import {
  type BackgroundCommandTarget,
  useBackgroundCommandDialogStore,
} from "../../backgroundCommandDialogStore";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useTheme } from "../../hooks/useTheme";
import { cn } from "~/lib/utils";
import { tickTextContent } from "~/lib/tickTextContent";
import { useBackgroundTaskOutput } from "../../state/queries";
import { threadEnvironment } from "../../state/threads";
import { useEnvironmentScope } from "../../state/session";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { useBackgroundCommands } from "./BackgroundCommandsPanel";
import { CommandOutputPanel, useCommandOutputStreaming } from "./CommandOutputPanel";

const FOLLOW_SLACK_PX = 24;

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

/** The output tail, following new text while the reader stays at the bottom. */
function TaskOutput(props: { readonly output: string }) {
  const { resolvedTheme } = useTheme();
  const scrollRef = useRef<HTMLPreElement>(null);
  const followRef = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pins the output scroller to the bottom after each commit while the reader follows
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  });
  const spans = terminalOutputSpans(props.output, TERMINAL_PALETTES[resolvedTheme]);
  return (
    <pre
      ref={scrollRef}
      onScroll={(event) => {
        const element = event.currentTarget;
        followRef.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_SLACK_PX;
      }}
      className={cn(codeBlockClass, "max-h-[min(50dvh,28rem)] min-h-40 text-muted-foreground")}
    >
      {spans.map((span, index) =>
        span.style === null ? (
          span.text
        ) : (
          // Spans never reorder and are rebuilt on each update.
          // oxlint-disable-next-line react/no-array-index-key
          <span key={index} style={span.style}>
            {span.text}
          </span>
        ),
      )}
    </pre>
  );
}

function BackgroundCommandDetails(props: {
  readonly target: BackgroundCommandTarget;
  readonly command: BackgroundCommand | undefined;
  readonly onClose: () => void;
}) {
  const { target, command } = props;
  const running = command?.running === true;
  const query = useBackgroundTaskOutput(command?.hasTaskOutput ? target : null, running);
  const streamsOutput = useCommandOutputStreaming(target.environmentId);
  const result = query.data;
  const commandText = result?.command ?? command?.command ?? null;
  const output = result?.output ?? null;
  const exitCode = result?.exitCode;

  const canStop = useEnvironmentScope(target.environmentId, AuthOrchestrationOperateScope);
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    setStopping(true);
    const outcome = await interruptTurn({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    });
    setStopping(false);
    if (outcome._tag === "Failure" && !isAtomCommandInterrupted(outcome)) {
      const error = squashAtomCommandFailure(outcome);
      toastManager.add({
        type: "error",
        title: "Could not stop background work",
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const startedAtMs = command?.startedAt ? Date.parse(command.startedAt) : null;
  const endedAtMs = result?.updatedAt ? Date.parse(result.updatedAt) : null;
  const status = command ? backgroundCommandStatusLabel({ running, exitCode }) : null;
  const ranFor =
    !running && startedAtMs !== null && endedAtMs !== null
      ? `ran ${formatDuration(Math.max(1_000, endedAtMs - startedAtMs))}`
      : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{command?.label ?? "Background command"}</DialogTitle>
        <DialogDescription>
          {[status, startedAtMs === null ? null : `started ${formatClock(startedAtMs)}`, ranFor]
            .filter(Boolean)
            .join(" · ")}
          {running && startedAtMs !== null ? (
            <>
              {" · "}
              <span
                ref={tickTextContent(
                  (nowMs) => formatDuration(Math.max(1_000, nowMs - startedAtMs)),
                  true,
                )}
                className="tabular-nums"
              />
            </>
          ) : null}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {commandText === null ? null : (
          <section className="flex flex-col gap-1.5">
            <div className="flex h-6 items-center justify-between">
              <h3 className="text-xs font-medium text-muted-foreground">
                {command?.kind === "monitor" ? "Watching" : "Command"}
              </h3>
              <CopyButton value={commandText} label="command" />
            </div>
            <pre className={cn(codeBlockClass, "max-h-36 text-foreground/90")}>{commandText}</pre>
          </section>
        )}
        <section className="flex flex-col gap-1.5">
          <div className="flex h-6 items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Output
              {result?.truncated ? (
                <span className="font-normal"> · end of {formatBytes(result.outputBytes)}</span>
              ) : null}
            </h3>
            <CopyButton value={output} label="output" />
          </div>
          {command?.hasTaskOutput !== true ? (
            command?.itemId && streamsOutput ? (
              <div className={cn(codeBlockClass, "min-h-20 text-muted-foreground")}>
                <CommandOutputPanel
                  environmentId={target.environmentId}
                  threadId={target.threadId}
                  itemId={command.itemId}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This command&apos;s output isn&apos;t available.
              </p>
            )
          ) : output === null ? (
            <p className="text-sm text-muted-foreground">
              {query.error
                ? `Couldn't read output: ${query.error}`
                : query.isPending && result === null
                  ? "Loading…"
                  : "The output file is gone."}
            </p>
          ) : output.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {running ? "No output yet." : "No output."}
            </p>
          ) : (
            <TaskOutput output={output} />
          )}
        </section>
      </DialogPanel>
      <DialogFooter variant="bare">
        {running && canStop ? (
          <Button
            variant="outline"
            disabled={stopping}
            onClick={() => void stop()}
            title="Stops all background work in this thread"
          >
            {stopping ? "Stopping…" : "Stop background work"}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={props.onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

/** Shows what a background command or monitor runs and prints. Mounted once per chat view. */
export function BackgroundCommandDialog() {
  const target = useBackgroundCommandDialogStore((state) => state.target);
  const close = useBackgroundCommandDialogStore((state) => state.close);
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogPopup className="max-w-3xl">
        {target === null ? null : <BackgroundCommandDetailsHost target={target} onClose={close} />}
      </DialogPopup>
    </Dialog>
  );
}

function BackgroundCommandDetailsHost(props: {
  readonly target: BackgroundCommandTarget;
  readonly onClose: () => void;
}) {
  const commands = useBackgroundCommands(props.target.environmentId, props.target.threadId);
  return (
    <BackgroundCommandDetails
      key={`${props.target.threadId}:${props.target.taskId}`}
      target={props.target}
      command={commands.find((candidate) => candidate.taskId === props.target.taskId)}
      onClose={props.onClose}
    />
  );
}
