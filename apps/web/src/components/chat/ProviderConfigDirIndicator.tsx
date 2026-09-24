import { memo } from "react";
import type { ProviderDriverKind } from "@t3tools/contracts";
import type { ProviderConfigDirIndicator as ConfigDirIndicator } from "@t3tools/client-runtime/state/provider-instance-display";
import { CircleAlertIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

export interface ThreadProviderConfigDir {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  readonly configDir: ConfigDirIndicator;
}

/**
 * Which provider profile a thread runs on: the instance badge, its name, and
 * the config dir its CLI uses. Turns into a warning when a launcher sent the
 * CLI to a different dir than the instance is configured with.
 */
export const ProviderConfigDirIndicator = memo(function ProviderConfigDirIndicator(props: {
  readonly value: ThreadProviderConfigDir;
  /** Narrow headers keep only the badge; the tooltip still names everything. */
  readonly compact: boolean;
}) {
  const { driverKind, displayName, accentColor, configDir } = props.value;
  const { current, configured, redirected } = configDir;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-provider-config-dir
            aria-label={
              redirected
                ? `${displayName}: redirected to ${current.path}, configured ${configured.path}`
                : `${displayName}: ${current.path}`
            }
            className={cn(
              "inline-flex min-w-0 items-center gap-1.5 text-xs",
              redirected ? "text-warning" : "text-muted-foreground",
            )}
          />
        }
      >
        <ProviderInstanceIcon
          driverKind={driverKind}
          displayName={displayName}
          accentColor={accentColor}
          showBadge
          className="size-4"
          iconClassName="size-4"
          indicatorBackground="var(--background)"
          badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-[7px]"
        />
        {props.compact ? null : (
          <>
            <span className="shrink-0 font-medium text-foreground">{displayName}</span>
            {redirected ? <CircleAlertIcon aria-hidden className="size-3 shrink-0" /> : null}
            <span className="min-w-0 truncate font-mono">
              {redirected ? `redirected to ${current.displayPath}` : current.displayPath}
            </span>
          </>
        )}
        {props.compact && redirected ? (
          <CircleAlertIcon aria-hidden className="size-3 shrink-0" />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <div className="flex max-w-96 flex-col gap-0.5">
          <span className="font-medium">{displayName}</span>
          {redirected ? (
            <>
              <span className="break-all">Running on {current.path}</span>
              <span className="break-all text-muted-foreground">
                Configured {configured.path}; the launcher switched it.
              </span>
            </>
          ) : (
            <span className="break-all">{current.path}</span>
          )}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
});
