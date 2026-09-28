/**
 * Option-key space affordances on sidebar thread rows.
 *
 * Holding Option shows, on every thread row, the spaces its project is in.
 * Option-dragging a row opens a panel of custom-space tiles near the pointer;
 * releasing over a tile adds the project to that space (the same overlay as
 * the menu's "Add to space"). Esc, a blur, or releasing anywhere else cancels.
 * The plain drag (reordering and sections, run by dnd-kit) ignores presses
 * with Option held, so the two never compete.
 */
import { CheckIcon } from "lucide-react";
import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

import { cn } from "~/lib/utils";
import { type ProjectSpaces, useSpaceStore } from "../../spaceStore";
import { toastManager } from "../ui/toast";
import { SpaceIcon } from "./SpaceSwitcher";
import {
  applySpaceDrop,
  SPACE_DRAG_THRESHOLD_PX,
  spaceDropTargets,
  threadSpaceBadges,
} from "./spaceDrag.logic";

/** Marks a thread row with its `${environmentId}:${projectId}`. */
export const THREAD_PROJECT_KEY_ATTRIBUTE = "data-thread-project-key";
const DROP_ATTRIBUTE = "data-space-drop-id";

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

interface ActiveDrag {
  readonly projectKey: string;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly hoverSpaceId: string | null;
  readonly flashSpaceId: string | null;
}

const PANEL_WIDTH = 280;

/** Listens for Option-drags that start on a thread row and renders the drop panel. */
export function SpaceDragLayer() {
  const resolve = useContext(SpaceRowProjectContext);
  const resolveRef = useRef(resolve);
  useEffect(() => {
    resolveRef.current = resolve;
  }, [resolve]);
  const spaces = useSpaceStore((store) => store.spaces);
  const [drag, setDrag] = useState<ActiveDrag | null>(null);

  useEffect(() => {
    let pending: {
      pointerId: number;
      x: number;
      y: number;
      projectKey: string;
    } | null = null;
    let active: ActiveDrag | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const update = (next: ActiveDrag | null) => {
      active = next;
      setDrag(next);
    };
    const suppressNextClick = () => {
      const suppress = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        document.removeEventListener("click", suppress, true);
      };
      document.addEventListener("click", suppress, true);
      // The click follows pointerup right away; never swallow a later one.
      setTimeout(() => document.removeEventListener("click", suppress, true), 400);
    };
    const cancel = () => {
      pending = null;
      if (active && active.flashSpaceId === null) update(null);
    };
    const hoverAt = (x: number, y: number) =>
      document
        .elementFromPoint(x, y)
        ?.closest(`[${DROP_ATTRIBUTE}]`)
        ?.getAttribute(DROP_ATTRIBUTE) ?? null;

    const onPointerDown = (event: PointerEvent) => {
      if (active) return;
      if (!event.altKey || event.button !== 0 || !event.isPrimary) return;
      const row = (event.target as Element | null)?.closest(`[${THREAD_PROJECT_KEY_ATTRIBUTE}]`);
      const projectKey = row?.getAttribute(THREAD_PROJECT_KEY_ATTRIBUTE);
      if (!projectKey) return;
      pending = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, projectKey };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (active && active.flashSpaceId === null) {
        event.preventDefault();
        const hoverSpaceId = hoverAt(event.clientX, event.clientY);
        if (hoverSpaceId !== active.hoverSpaceId) update({ ...active, hoverSpaceId });
        return;
      }
      if (!pending || event.pointerId !== pending.pointerId) return;
      if ((event.buttons & 1) === 0) return cancel();
      if (
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= SPACE_DRAG_THRESHOLD_PX
      ) {
        return;
      }
      event.preventDefault();
      document.getSelection()?.removeAllRanges();
      update({
        projectKey: pending.projectKey,
        anchor: { x: pending.x, y: pending.y },
        hoverSpaceId: null,
        flashSpaceId: null,
      });
      pending = null;
    };
    const onPointerUp = (event: PointerEvent) => {
      pending = null;
      if (!active || active.flashSpaceId !== null) return;
      event.preventDefault();
      suppressNextClick();
      const spaceId = hoverAt(event.clientX, event.clientY);
      const project = resolveRef.current?.(active.projectKey);
      if (!spaceId || !project) return update(null);
      const store = useSpaceStore.getState();
      const { outcome } = applySpaceDrop(store, project.memberKeys, spaceId);
      const spaceName = store.spaces.find((space) => space.id === spaceId)?.name ?? "space";
      const projectName = project.label ?? "Project";
      if (outcome === "rejected") return update(null);
      if (outcome === "added") {
        store.setProjectsInSpace(project.memberKeys, spaceId, true);
        toastManager.add({ type: "success", title: `Added ${projectName} to ${spaceName}` });
      } else {
        toastManager.add({ type: "info", title: `${projectName} is already in ${spaceName}` });
      }
      // Flash the tile, then close.
      update({ ...active, hoverSpaceId: spaceId, flashSpaceId: spaceId });
      closeTimer = setTimeout(() => update(null), 550);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!active && !pending)) return;
      event.preventDefault();
      event.stopPropagation();
      if (active) suppressNextClick();
      cancel();
    };
    // Option-drag must not turn into a native (copy) drag of a link or image in the row.
    const onDragStart = (event: DragEvent) => {
      if (pending || active) event.preventDefault();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("dragstart", onDragStart, true);
    window.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", cancel, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("dragstart", onDragStart, true);
      window.removeEventListener("blur", cancel);
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, []);

  if (!drag || !resolve) return null;
  const project = resolve(drag.projectKey);
  const targets = spaceDropTargets(spaces, project.spaces);
  const left = Math.max(8, Math.min(drag.anchor.x + 24, window.innerWidth - PANEL_WIDTH - 8));
  const top = Math.max(8, Math.min(drag.anchor.y - 40, window.innerHeight - 220));
  return createPortal(
    <div
      role="dialog"
      aria-label="Add project to a space"
      data-testid="space-drop-panel"
      className="fixed z-50 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg select-none"
      style={{ left, top, width: PANEL_WIDTH }}
    >
      <div className="truncate px-1 pb-2 text-xs text-muted-foreground">
        Add <span className="font-medium text-foreground">{project.label ?? "project"}</span> to a
        space
      </div>
      {targets.length === 0 ? (
        <div className="px-1 pb-1 text-xs text-muted-foreground">
          No custom spaces yet. Make one with + in the space bar.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {targets.map(({ space, isMember }) => {
            const hovered = drag.hoverSpaceId === space.id;
            const flashed = drag.flashSpaceId === space.id;
            return (
              <div
                key={space.id}
                {...{ [DROP_ATTRIBUTE]: space.id }}
                aria-label={isMember ? `${space.name} (already added)` : space.name}
                className={cn(
                  "relative flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border border-border/60 px-1 text-xs transition-colors",
                  hovered && "border-primary bg-primary/10 ring-2 ring-primary/40",
                  flashed && "border-success bg-success/15 ring-2 ring-success/50",
                )}
              >
                <SpaceIcon icon={space.icon} className="size-7" />
                <span className="w-full truncate text-center">{space.name}</span>
                {isMember || flashed ? (
                  <CheckIcon
                    aria-hidden="true"
                    className="absolute top-1 right-1 size-3.5 text-success"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <div className="px-1 pt-2 text-2xs text-muted-foreground">
        Release on a space to add · Esc cancels
      </div>
    </div>,
    document.body,
  );
}
