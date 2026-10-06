import { CompassIcon } from "lucide-react";

import { useIsManagerThread } from "../../brainstormStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** A small compass in front of the manager thread's title in thread lists. */
export function ManagerThreadMarker(props: {
  readonly environmentId: string;
  readonly threadId: string;
}) {
  const isManager = useIsManagerThread(props.environmentId, props.threadId);
  if (!isManager) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <CompassIcon
            aria-label="Manager thread"
            data-manager-thread-marker=""
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        }
      />
      <TooltipPopup side="top">Manager thread</TooltipPopup>
    </Tooltip>
  );
}
