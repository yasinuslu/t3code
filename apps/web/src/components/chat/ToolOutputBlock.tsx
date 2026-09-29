import { useAtomValue } from "@effect/atom-react";
import { EventId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";

const outputPreClassName =
  "max-h-72 cursor-text overflow-auto whitespace-pre-wrap break-words font-mono text-secondary-label text-(length:--font-size-code,var(--text-2xs)) leading-relaxed select-text";

/**
 * Full output of one tool call. Snapshots only carry a one-line summary, so
 * the output is fetched when the row is expanded (never for collapsed rows)
 * and rendered in a bounded, scrollable block.
 */
export function ToolOutputBlock(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  activityId: string;
  running: boolean;
  failed: boolean;
  className?: string | undefined;
}) {
  if (props.running) {
    return (
      <div
        className={cn("text-xs text-muted-foreground", props.className)}
        data-tool-output="running"
      >
        Running…
      </div>
    );
  }
  return <SettledToolOutput {...props} />;
}

function SettledToolOutput(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  activityId: string;
  failed: boolean;
  className?: string | undefined;
}) {
  const result = useAtomValue(
    orchestrationEnvironment.activityOutput({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, activityId: EventId.make(props.activityId) },
    }),
  );
  if (result._tag === "Success") {
    const { output, truncated } = result.value;
    if (output === null) {
      return (
        <div
          className={cn("text-xs text-muted-foreground", props.className)}
          data-tool-output="empty"
        >
          No output
        </div>
      );
    }
    return (
      <div className={props.className} data-tool-output={props.failed ? "error" : "output"}>
        <div
          className={cn(
            "mb-1 text-3xs font-medium uppercase tracking-wider",
            props.failed ? "text-destructive-foreground" : "text-muted-foreground/80",
          )}
        >
          {props.failed ? "Error output" : "Output"}
          {truncated ? " · truncated" : ""}
        </div>
        <pre className={outputPreClassName}>{output}</pre>
      </div>
    );
  }
  if (result._tag === "Failure") {
    return (
      <div
        className={cn("text-xs text-destructive-foreground", props.className)}
        data-tool-output="unavailable"
      >
        Output unavailable
      </div>
    );
  }
  return (
    <div
      className={cn("text-xs text-muted-foreground", props.className)}
      data-tool-output="loading"
    >
      Loading output…
    </div>
  );
}
