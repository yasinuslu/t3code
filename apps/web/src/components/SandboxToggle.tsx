import { BoxIcon } from "lucide-react";
import { memo } from "react";

import { Toggle } from "./ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** A draft's choice to run in a sandbox, independent of the folder it picks. */
export interface SandboxChoice {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

export const SANDBOX_TOGGLE_DESCRIPTION =
  "Run this thread in a sandbox: an isolated machine of its folder. Other threads there stay on the host.";

/** Composer toggle next to the workspace picker. */
export const SandboxToggle = memo(function SandboxToggle(props: {
  readonly choice: SandboxChoice;
  readonly disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            variant="ghost"
            size="xs"
            pressed={props.choice.checked}
            onPressedChange={props.choice.onCheckedChange}
            disabled={props.disabled}
            aria-label="Run in sandbox"
            data-composer-context-control
            data-sandbox-toggle
          />
        }
      >
        <BoxIcon className="size-3" />
        <span className="text-xs font-normal">Sandbox</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{SANDBOX_TOGGLE_DESCRIPTION}</TooltipPopup>
    </Tooltip>
  );
});
