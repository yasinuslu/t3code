/**
 * Option-key space affordances on sidebar thread rows.
 *
 * Holding Option shows, on every thread row, the spaces its project is in.
 * Option-clicking a row opens a small popover next to it that lists the
 * custom spaces as toggles (the same overlay as the menu's "Add to space");
 * it stays open so several can be toggled. Esc, a click outside, or another
 * Option-click on the row closes it. Option-click never opens the thread,
 * and the plain drag (dnd-kit) ignores presses with Option held.
 */
import { CheckIcon } from "lucide-react";
import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

import { cn } from "~/lib/utils";
import { type ProjectSpaces, useSpaceStore } from "../../spaceStore";
import { SpaceIcon } from "./SpaceSwitcher";
import {
  spaceToggleEntries,
  threadSpaceBadges,
  toggleProjectInSpace,
} from "./spaceMembership.logic";

/** Marks a thread row with its `${environmentId}:${projectId}`. */
export const THREAD_PROJECT_KEY_ATTRIBUTE = "data-thread-project-key";

const useOptionKeyStore = create<{ readonly held: boolean }>(() => ({ held: false }));

function setOptionHeld(held: boolean) {
  if (useOptionKeyStore.getState().held !== held) useOptionKeyStore.setState({ held });
}

/**
 * Tracks whether Option (Alt) is held. Keyboard-driven, re-synced from the
 * modifier state of every key and pointer event, and cleared when the window
 * loses focus so it never sticks.
 */
export function useOptionKeyTracking() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => setOptionHeld(event.key === "Alt" || event.altKey);
    const onKeyUp = (event: KeyboardEvent) =>
      setOptionHeld(event.key === "Alt" ? false : event.altKey);
    const onPointer = (event: PointerEvent) => setOptionHeld(event.altKey);
    const clear = () => setOptionHeld(false);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") clear();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointermove", onPointer, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointermove", onPointer, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", onVisibility);
      clear();
    };
  }, []);
}

export interface SpaceRowProject {
  /** Every `${environmentId}:${projectId}` of the logical project. */
  readonly memberKeys: ReadonlyArray<string>;
  readonly spaces: ProjectSpaces;
  readonly label: string | null;
}

/** Resolves a row's project key to its logical project and spaces. */
export const SpaceRowProjectContext = createContext<
  ((projectKey: string) => SpaceRowProject) | null
>(null);

/** Space badges on a thread row while Option is held. */
export const ThreadSpaceBadges = memo(function ThreadSpaceBadges({
  projectKey,
}: {
  readonly projectKey: string;
}) {
  const held = useOptionKeyStore((store) => store.held);
  const resolve = useContext(SpaceRowProjectContext);
  const spaces = useSpaceStore((store) => store.spaces);
  if (!held || !resolve) return null;
  const badges = threadSpaceBadges(spaces, resolve(projectKey).spaces);
  if (badges.length === 0) return null;
  return (
    <span
      data-testid="thread-space-badges"
      aria-label={`Spaces: ${badges.map((space) => space.name).join(", ")}`}
      className="pointer-events-none absolute top-1/2 right-2 z-30 flex -translate-y-1/2 items-center gap-1 rounded-md border border-border bg-popover px-1 py-0.5 shadow-sm"
    >
      {badges.map((space) => (
        <span key={space.id} className="inline-flex size-4 shrink-0">
          <SpaceIcon icon={space.icon} className="size-4" />
        </span>
      ))}
    </span>
  );
});

interface OpenPopover {
  readonly projectKey: string;
  readonly row: Element;
}

const POPOVER_WIDTH = 232;

/** Opens the space popover on Option-click of a thread row and renders it. */
export function SpaceMembershipPopoverLayer() {
  const resolve = useContext(SpaceRowProjectContext);
  const spaces = useSpaceStore((store) => store.spaces);
  const [open, setOpen] = useState<OpenPopover | null>(null);
  const openRef = useRef(open);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const rowOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest(`[${THREAD_PROJECT_KEY_ATTRIBUTE}]`) : null;
    const inPopover = (target: EventTarget | null) =>
      target instanceof Node && popoverRef.current?.contains(target) === true;
    // Option-click is ours: it must not select, open or rename the thread.
    const onClick = (event: MouseEvent) => {
      if (!event.altKey || event.button !== 0 || inPopover(event.target)) return;
      const row = rowOf(event.target);
      const projectKey = row?.getAttribute(THREAD_PROJECT_KEY_ATTRIBUTE);
      if (!row || !projectKey) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(openRef.current?.row === row ? null : { projectKey, row });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!openRef.current || inPopover(event.target)) return;
      // An Option-press on a row is a toggle; the click that follows decides.
      if (event.altKey && rowOf(event.target)) return;
      setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !openRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(null);
    };
    const onDoubleClick = (event: MouseEvent) => {
      if (event.altKey && rowOf(event.target)) event.stopPropagation();
    };
    const close = () => setOpen(null);
    document.addEventListener("click", onClick, true);
    document.addEventListener("dblclick", onDoubleClick, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("dblclick", onDoubleClick, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  // The row can scroll away or unmount (space switch, settle); follow or close.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const onScroll = () => setTick((tick) => tick + 1);
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [open]);

  if (!open || !resolve || !open.row.isConnected) return null;
  const project = resolve(open.projectKey);
  const entries = spaceToggleEntries(spaces, project.spaces);
  const rect = open.row.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right + 6, window.innerWidth - POPOVER_WIDTH - 8));
  const top = Math.max(8, Math.min(rect.top, window.innerHeight - 48 - entries.length * 32));
  const hasCustom = entries.some((entry) => !entry.fixed);
  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Spaces for ${project.label ?? "project"}`}
      data-testid="space-membership-popover"
      className="fixed z-50 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg select-none"
      style={{ left, top, width: POPOVER_WIDTH }}
    >
      <div className="truncate px-2 pt-1 pb-1.5 text-2xs text-muted-foreground">
        Spaces for <span className="font-medium text-foreground">{project.label ?? "project"}</span>
      </div>
      {entries.map(({ space, checked, fixed }) => (
        <button
          key={space.id}
          type="button"
          role="menuitemcheckbox"
          aria-checked={checked}
          aria-disabled={fixed || undefined}
          disabled={fixed}
          data-space-toggle-id={space.id}
          onClick={() =>
            useSpaceStore.setState((state) =>
              toggleProjectInSpace(state, project.memberKeys, space.id),
            )
          }
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-hidden",
            fixed
              ? "cursor-default text-muted-foreground"
              : "cursor-pointer hover:bg-accent focus-visible:bg-accent",
          )}
        >
          <SpaceIcon icon={space.icon} className="size-4" />
          <span className="min-w-0 flex-1 truncate">{space.name}</span>
          {fixed ? (
            <span className="text-2xs text-muted-foreground">always</span>
          ) : checked ? (
            <CheckIcon aria-hidden="true" className="size-4 text-foreground" />
          ) : null}
        </button>
      ))}
      {hasCustom ? null : (
        <div className="px-2 py-1.5 text-2xs text-muted-foreground">
          No custom spaces yet. Make one with + in the space bar.
        </div>
      )}
    </div>,
    document.body,
  );
}
