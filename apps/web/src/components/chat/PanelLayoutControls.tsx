import {
  PanelBottomIcon,
  PanelRightIcon,
  PresentationIcon,
  SquareMenuIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
import { memo, type ReactNode, useLayoutEffect, useRef } from "react";

import { cn } from "~/lib/utils";

import type { ThreadPanelPresentation } from "../../rightPanelLayout";
import { PopoverCreateHandle, PopoverTrigger } from "../ui/popover";
import { useMobileSidebarSheetMounted } from "../ui/sidebar";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { DesktopUpdateTitlebarButton } from "./DesktopUpdateTitlebarButton";

/** Matches the right inset of `ThreadPanelHeaderControl`. */
const THREAD_PANEL_HEADER_INSET_PX = 12;

export interface PanelLayoutControlsProps {
  /** The app update button; off for secondary copies so it shows once. */
  showUpdateControl?: boolean;
  showThreadPanelControl?: boolean;
  showTerminalControl?: boolean;
  showRightPanelControl?: boolean;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalShortcutLabel: string | null;
  threadPanelOpen: boolean;
  threadPanelPresentation: ThreadPanelPresentation;
  threadPanelPopoverHandle?: ReturnType<typeof PopoverCreateHandle>;
  threadPanelShortcutLabel: string | null;
  rightPanelAvailable: boolean;
  rightPanelOpen: boolean;
  rightPanelShortcutLabel: string | null;
  rightPanelUnavailableLabel?: string;
  /** The thread's presentation, one tap from anywhere in the thread; omitted where there is none. */
  presentationAvailable?: boolean;
  /** Shown whenever the right panel control is, unless set: a chat in Grow has no panel but a dialog. */
  showPresentationControl?: boolean;
  presentationOpen?: boolean;
  /** The presentation changed since the user last looked at it. */
  presentationUnseen?: boolean;
  presentationShortcutLabel?: string | null;
  onTogglePresentation?: () => void;
  onToggleTerminal: () => void;
  onToggleThreadPanel: () => void;
  onToggleRightPanel: () => void;
}

export const PanelLayoutControls = memo(function PanelLayoutControls({
  showThreadPanelControl = true,
  showTerminalControl = true,
  showRightPanelControl = true,
  terminalAvailable,
  terminalOpen,
  terminalShortcutLabel,
  threadPanelOpen,
  threadPanelPresentation,
  threadPanelPopoverHandle,
  threadPanelShortcutLabel,
  rightPanelAvailable,
  rightPanelOpen,
  rightPanelShortcutLabel,
  rightPanelUnavailableLabel = "Right panel is unavailable",
  presentationAvailable = false,
  showPresentationControl = showRightPanelControl,
  presentationOpen = false,
  presentationUnseen = false,
  presentationShortcutLabel = null,
  onTogglePresentation,
  onToggleTerminal,
  onToggleThreadPanel,
  onToggleRightPanel,
  showUpdateControl = true,
}: PanelLayoutControlsProps) {
  const threadPanelToggle = (
    <Toggle
      className="relative shrink-0 [-webkit-app-region:no-drag]"
      pressed={threadPanelOpen}
      onPressedChange={threadPanelPresentation === "popover" ? undefined : onToggleThreadPanel}
      aria-label="Toggle thread details panel"
      variant="ghost"
      size="sm"
    >
      <SquareMenuIcon className="size-4" />
    </Toggle>
  );
  const threadPanelControl = (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0" data-thread-panel-toggle />}>
        {threadPanelPresentation === "popover" ? (
          <PopoverTrigger handle={threadPanelPopoverHandle} render={threadPanelToggle} />
        ) : (
          threadPanelToggle
        )}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        Toggle thread details
        {threadPanelShortcutLabel ? ` (${threadPanelShortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );

  return (
    <div
      className="flex h-full shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      data-panel-layout-controls
    >
      {showUpdateControl ? <DesktopUpdateTitlebarButton /> : null}
      {showThreadPanelControl ? threadPanelControl : null}
      {showTerminalControl ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex shrink-0" />}>
            <Toggle
              className="shrink-0 [-webkit-app-region:no-drag]"
              pressed={terminalOpen}
              onPressedChange={onToggleTerminal}
              aria-label="Toggle terminal drawer"
              variant="ghost"
              size="sm"
              disabled={!terminalAvailable}
            >
              <PanelBottomIcon className="size-4" />
            </Toggle>
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {terminalAvailable
              ? `Toggle terminal drawer${terminalShortcutLabel ? ` (${terminalShortcutLabel})` : ""}`
              : "Terminal drawer is unavailable"}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {showPresentationControl && presentationAvailable && onTogglePresentation ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex shrink-0" />}>
            <Toggle
              className="relative shrink-0 [-webkit-app-region:no-drag]"
              pressed={presentationOpen}
              onPressedChange={onTogglePresentation}
              aria-label={
                presentationUnseen ? "Toggle presentation, updated" : "Toggle presentation"
              }
              variant="ghost"
              size="sm"
            >
              <PresentationIcon className="size-4" />
              {presentationUnseen ? (
                <span
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-info ring-2 ring-background"
                  aria-hidden="true"
                  data-presentation-updated
                />
              ) : null}
            </Toggle>
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {presentationUnseen ? "Presentation, updated" : "Presentation"}
            {presentationShortcutLabel ? ` (${presentationShortcutLabel})` : ""}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {showRightPanelControl ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex shrink-0" />}>
            <Toggle
              className="shrink-0 [-webkit-app-region:no-drag]"
              pressed={rightPanelOpen}
              onPressedChange={onToggleRightPanel}
              aria-label="Toggle right panel"
              data-right-panel-toggle
              variant="ghost"
              size="sm"
              disabled={!rightPanelAvailable}
            >
              <PanelRightIcon className="size-4" />
            </Toggle>
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {rightPanelAvailable
              ? `Toggle right panel${rightPanelShortcutLabel ? ` (${rightPanelShortcutLabel})` : ""}`
              : rightPanelUnavailableLabel}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
});

export const RightPanelMaximizeControl = memo(function RightPanelMaximizeControl({
  maximized,
  onToggle,
}: {
  maximized: boolean;
  onToggle: () => void;
}) {
  const label = maximized ? "Restore panel size" : "Maximize panel";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0 [-webkit-app-region:no-drag]"
            pressed={maximized}
            onPressedChange={onToggle}
            aria-label={label}
            variant="ghost"
            size="sm"
          >
            {maximized ? (
              <Minimize2Icon className="size-4" />
            ) : (
              <Maximize2Icon className="size-4" />
            )}
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
});

/** The thread panel toggle on a header whose right side the inline right panel covers. */
export function ThreadPanelHeaderControl(props: PanelLayoutControlsProps) {
  const mobileSidebarSheetMounted = useMobileSidebarSheetMounted();
  return (
    <div
      className={cn(
        "absolute top-[var(--workspace-controls-top)] right-[calc(env(safe-area-inset-right)+0.75rem)] z-45 flex h-[var(--workspace-topbar-height)] items-center [-webkit-app-region:no-drag]",
        mobileSidebarSheetMounted && "hidden",
      )}
      data-workspace-titlebar-controls
    >
      <PanelLayoutControls
        {...props}
        showUpdateControl={false}
        showTerminalControl={false}
        showRightPanelControl={false}
      />
    </div>
  );
}

/** The window's top-right panel controls, with the maximize toggle while the panel is open. */
export function WorkspaceTitlebarControls(props: {
  readonly showMaximizeControl: boolean;
  readonly rightPanelOpen: boolean;
  readonly animationsActive: boolean;
  readonly maximized: boolean;
  readonly onToggleMaximized: () => void;
  readonly children: ReactNode;
}) {
  const { rightPanelOpen, maximized } = props;
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const previous = useRef({ rightPanelOpen, maximized });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts the toggle's slide before the commit that swapped it in paints; the animation is cancelled on change or unmount.
  useLayoutEffect(() => {
    const { rightPanelOpen: wasOpen, maximized: wasMaximized } = previous.current;
    previous.current = { rightPanelOpen, maximized };
    if (!wasOpen || rightPanelOpen || wasMaximized) return;
    const toggle = controlsRef.current?.querySelector("[data-thread-panel-toggle]");
    const panel = toggle?.ownerDocument.querySelector("[data-preview-panel-mode='inline']");
    const timing = panel?.getAnimations()[0]?.effect?.getTiming();
    if (!toggle || !panel || !timing) return;
    // The header's toggle was just removed, so slide this one in from where it sat.
    const headerRight = panel.getBoundingClientRect().left - THREAD_PANEL_HEADER_INSET_PX;
    const offset = headerRight - toggle.getBoundingClientRect().right;
    const animation = toggle.animate(
      [{ transform: `translateX(${offset}px)` }, { transform: "none" }],
      { ...timing, easing: getComputedStyle(panel).transitionTimingFunction },
    );
    return () => animation.cancel();
  }, [rightPanelOpen, maximized]);

  const mobileSidebarSheetMounted = useMobileSidebarSheetMounted();
  return (
    <div
      ref={controlsRef}
      className={cn(
        "pointer-events-none fixed top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] z-45 mr-px flex h-[var(--workspace-topbar-height)] items-center gap-1 [-webkit-app-region:no-drag]",
        mobileSidebarSheetMounted && "hidden",
      )}
      data-workspace-titlebar-controls
    >
      {props.showMaximizeControl ? (
        <span
          aria-hidden={!props.rightPanelOpen}
          // Fading out on close would show it beside the thread details toggle that replaces it.
          className={cn(
            "flex shrink-0",
            props.rightPanelOpen &&
              props.animationsActive &&
              "motion-safe:transition-opacity motion-safe:duration-(--panel-animation-duration) motion-safe:ease-out",
            props.rightPanelOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none absolute right-full mr-1 opacity-0",
          )}
          inert={!props.rightPanelOpen}
        >
          <RightPanelMaximizeControl
            maximized={props.maximized}
            onToggle={props.onToggleMaximized}
          />
        </span>
      ) : null}
      <div className="pointer-events-auto flex h-full items-center">{props.children}</div>
    </div>
  );
}
