import { CloudOffIcon } from "lucide-react";

/** The manager's machine is offline or not connected: say so, and what still works. */
export function ManagerUnavailable(props: { readonly message: string; readonly offline: boolean }) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
      data-manager-unavailable=""
    >
      <CloudOffIcon className="size-6 text-muted-foreground" aria-hidden />
      <p className="font-medium text-sm">
        {props.offline ? "Manager host offline" : "The manager could not open"}
      </p>
      <p className="max-w-sm text-muted-foreground text-sm">{props.message}</p>
      {props.offline ? (
        <p className="max-w-sm text-muted-foreground text-xs">
          It comes back here by itself once that machine reconnects. Your other threads keep
          working.
        </p>
      ) : null}
    </div>
  );
}
