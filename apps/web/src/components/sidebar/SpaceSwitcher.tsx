import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectIconOverride } from "@t3tools/contracts";
import { FolderIcon, PlusIcon } from "lucide-react";
import type { IconName } from "lucide-react/dynamic";
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";

import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { PROJECT_ICON_COLORS, projectIconColorClassName } from "../../projectIconColors";
import {
  adjacentSpaceId,
  ALL_SPACE_ID,
  createSpaceSwipeTracker,
  isBuiltinSpace,
  type Space,
  spaceColor,
  useSpaceStore,
} from "../../spaceStore";
import { useEnvironments } from "../../state/environments";
import { filesystemEnvironment } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { ProjectMonogram } from "../ProjectMonogram";
import { ProjectIconPickerDialog } from "../settings/ProjectIconPickerDialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const DynamicIcon = lazy(() =>
  import("lucide-react/dynamic").then((module) => ({ default: module.DynamicIcon })),
);

function SpaceIconFallback() {
  return <FolderIcon className="size-full" />;
}

export function SpaceIcon({
  icon,
  className,
}: {
  readonly icon: ProjectIconOverride;
  readonly className?: string;
}) {
  if (icon.kind === "monogram") {
    return <ProjectMonogram text={icon.text} color={icon.color} className={className} />;
  }
  if (icon.kind === "emoji") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center leading-none",
          className,
        )}
      >
        {icon.emoji}
      </span>
    );
  }
  const colorClassName = projectIconColorClassName(icon.color);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center",
        colorClassName,
        className,
      )}
    >
      <Suspense fallback={<SpaceIconFallback />}>
        <DynamicIcon
          name={icon.name as IconName}
          className="size-full"
          fallback={SpaceIconFallback}
        />
      </Suspense>
    </span>
  );
}

function swatchClassName(space: Space): string {
  const color = spaceColor(space);
  return PROJECT_ICON_COLORS.find((option) => option.value === color)?.swatchClassName ?? "";
}

/** The active space's icon and name, for headers. Renders nothing for All. */
export function ActiveSpaceLabel({ className }: { readonly className?: string }) {
  const space = useSpaceStore(
    (store) => store.spaces.find((candidate) => candidate.id === store.activeSpaceId) ?? null,
  );
  if (!space || space.id === ALL_SPACE_ID) return null;
  return (
    <span
      data-space-id={space.id}
      className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
    >
      <SpaceIcon icon={space.icon} className="size-3.5" />
      <span className="truncate">{space.name}</span>
    </span>
  );
}

function CodeProfileProbe({
  environmentId,
  paths,
  projectKeyByPath,
}: {
  readonly environmentId: EnvironmentId;
  readonly paths: ReadonlyArray<string>;
  readonly projectKeyByPath: ReadonlyMap<string, ReadonlyArray<string>>;
}) {
  const recordCodeProfiles = useSpaceStore((store) => store.recordCodeProfiles);
  const query = useEnvironmentQuery(
    paths.length > 0
      ? filesystemEnvironment.codeProfiles({ environmentId, input: { paths: [...paths] } })
      : null,
  );
  const data = query.data;
  useEffect(() => {
    if (!data) return;
    const detected: Record<string, string | null> = {};
    for (const assignment of data.assignments) {
      for (const projectKey of projectKeyByPath.get(assignment.path) ?? []) {
        detected[projectKey] = assignment.profile;
      }
    }
    recordCodeProfiles(
      data.profiles.map((profile) => profile.name),
      detected,
    );
  }, [data, projectKeyByPath, recordCodeProfiles]);
  return null;
}

/**
 * Asks each environment that supports it which code profile its projects sit
 * in. Results land in the space store, which seeds spaces and default
 * placements from them.
 */
export const CodeProfileProbes = memo(function CodeProfileProbes({
  projects,
}: {
  readonly projects: ReadonlyArray<
    Pick<EnvironmentProject, "environmentId" | "id" | "workspaceRoot">
  >;
}) {
  const { environments } = useEnvironments();
  const probes = useMemo(() => {
    const supported = new Set(
      environments
        .filter(
          (environment) => environment.serverConfig?.environment.capabilities.codeProfiles === true,
        )
        .map((environment) => environment.environmentId),
    );
    const byEnvironment = new Map<EnvironmentId, Map<string, string[]>>();
    for (const project of projects) {
      if (!supported.has(project.environmentId)) continue;
      const byPath = byEnvironment.get(project.environmentId) ?? new Map<string, string[]>();
      byEnvironment.set(project.environmentId, byPath);
      const keys = byPath.get(project.workspaceRoot) ?? [];
      keys.push(`${project.environmentId}:${project.id}`);
      byPath.set(project.workspaceRoot, keys);
    }
    return [...byEnvironment].map(([environmentId, byPath]) => ({
      environmentId,
      paths: [...byPath.keys()].toSorted(),
      projectKeyByPath: byPath as ReadonlyMap<string, ReadonlyArray<string>>,
    }));
  }, [environments, projects]);
  return (
    <>
      {probes.map((probe) => (
        <CodeProfileProbe key={probe.environmentId} {...probe} />
      ))}
    </>
  );
});

export function SpaceEditDialog({
  space,
  onOpenChange,
  onSave,
}: {
  readonly space: Space;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (patch: Pick<Space, "name" | "icon" | "color">) => void;
}) {
  const [name, setName] = useState(space.name);
  const [icon, setIcon] = useState<ProjectIconOverride>(space.icon);
  const [color, setColor] = useState<Space["color"]>(space.color);
  const [pickerOpen, setPickerOpen] = useState(false);
  const trimmedName = name.trim();
  const save = () => {
    if (trimmedName.length === 0) return;
    onSave({ name: trimmedName, icon, color: icon.kind === "emoji" ? color : icon.color });
    onOpenChange(false);
  };
  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogPopup className="w-full sm:w-[24rem]">
          <DialogHeader>
            <DialogTitle>Edit space</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Change icon and color"
                title="Change icon and color"
                onClick={() => setPickerOpen(true)}
              >
                <SpaceIcon icon={icon} />
              </Button>
              <Input
                autoFocus
                aria-label="Space name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") save();
                }}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={trimmedName.length === 0}>
              Save
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <ProjectIconPickerDialog
        title="Choose space icon"
        current={icon}
        projectName={trimmedName || "Space"}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(next) => {
          setIcon(next);
          if (next.kind !== "emoji") setColor(next.color);
        }}
      />
    </>
  );
}

function switchSpaceBy(direction: 1 | -1, onSwitch: (spaceId: string) => void) {
  const { spaces, activeSpaceId } = useSpaceStore.getState();
  const next = adjacentSpaceId(spaces, activeSpaceId, direction);
  if (next) onSwitch(next);
}

/** Wheel handler that switches spaces on a horizontal two-finger swipe. */
export function useSpaceSwipe(onSwitch: (spaceId: string) => void) {
  const [tracker] = useState(createSpaceSwipeTracker);
  return (event: WheelEvent) => {
    const direction = tracker(event);
    if (direction !== null) switchSpaceBy(direction, onSwitch);
  };
}

/**
 * Mouse thumb buttons switch spaces while the pointer is over the sidebar:
 * back (3) to the previous space, forward (4) to the next. Elsewhere they
 * keep their default. Capture phase, and every event of the press is
 * swallowed, so neither sidebar rows nor Chromium's own back/forward
 * handling can act on it; the switch runs once, on mouseup.
 */
export function useSpaceMouseButtons(onSwitch: (spaceId: string) => void) {
  const onSwitchRef = useRef(onSwitch);
  useEffect(() => {
    onSwitchRef.current = onSwitch;
  }, [onSwitch]);
  useEffect(() => {
    const handle = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      if (!(event.target instanceof Element) || !event.target.closest("[data-app-sidebar]")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.type === "mouseup") switchSpaceBy(event.button === 3 ? -1 : 1, onSwitchRef.current);
    };
    // Pointer events are left alone: preventing pointerdown would suppress
    // the mouseup this acts on.
    const types = ["mousedown", "mouseup", "auxclick"] as const;
    for (const type of types) window.addEventListener(type, handle, true);
    return () => {
      for (const type of types) window.removeEventListener(type, handle, true);
    };
  }, []);
}

/**
 * Zen-style row of space icons at the bottom of the sidebar. Click switches,
 * right-click edits or deletes, "+" adds a space.
 */
export const SpaceSwitcher = memo(function SpaceSwitcher({
  onSwitch,
}: {
  readonly onSwitch: (spaceId: string) => void;
}) {
  const spaces = useSpaceStore((store) => store.spaces);
  const activeSpaceId = useSpaceStore((store) => store.activeSpaceId);
  const createSpace = useSpaceStore((store) => store.createSpace);
  const updateSpace = useSpaceStore((store) => store.updateSpace);
  const deleteSpace = useSpaceStore((store) => store.deleteSpace);
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
  const editingSpace = spaces.find((space) => space.id === editingSpaceId) ?? null;
  const handleSwipe = useSpaceSwipe(onSwitch);

  const handleDelete = async (space: Space) => {
    const api = readLocalApi();
    const confirmed = api
      ? await api.dialogs.confirm(
          `Delete space "${space.name}"?\nIts projects move back to their default space.`,
          { variant: "destructive" },
        )
      : true;
    if (!confirmed) return;
    if (activeSpaceId === space.id) onSwitch(ALL_SPACE_ID);
    deleteSpace(space.id);
  };

  const handleContextMenu = async (space: Space, position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    const clicked = await api.contextMenu.show<"edit" | "delete">(
      [
        { id: "edit", label: "Edit space…", icon: "pencil" },
        ...(isBuiltinSpace(space.id)
          ? []
          : [
              {
                id: "delete" as const,
                label: "Delete space",
                icon: "trash",
                destructive: true,
                separatorBefore: true,
              },
            ]),
      ],
      position,
    );
    if (clicked === "edit") setEditingSpaceId(space.id);
    if (clicked === "delete") void handleDelete(space);
  };

  return (
    <div
      role="tablist"
      aria-label="Spaces"
      className="flex min-w-0 items-center justify-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none]"
      onWheel={handleSwipe}
    >
      {spaces.map((space) => {
        const active = space.id === activeSpaceId;
        return (
          <Tooltip key={space.id}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={space.name}
                  data-space-id={space.id}
                  onClick={() => onSwitch(space.id)}
                  onDoubleClick={() => setEditingSpaceId(space.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void handleContextMenu(space, { x: event.clientX, y: event.clientY });
                  }}
                  className={cn(
                    "relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md outline-hidden transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "bg-sidebar-row-hover" : "opacity-60 hover:opacity-100",
                  )}
                />
              }
            >
              <SpaceIcon icon={space.icon} />
              {active ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute bottom-0.5 h-0.5 w-3 rounded-full",
                    swatchClassName(space),
                  )}
                />
              ) : null}
            </TooltipTrigger>
            <TooltipPopup side="top">{space.name}</TooltipPopup>
          </Tooltip>
        );
      })}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="New space"
              onClick={() => {
                const id = createSpace(`Space ${spaces.length - 1}`);
                onSwitch(id);
                setEditingSpaceId(id);
              }}
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground/70 outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <PlusIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="top">New space</TooltipPopup>
      </Tooltip>
      {editingSpace ? (
        <SpaceEditDialog
          key={editingSpace.id}
          space={editingSpace}
          onOpenChange={(open) => {
            if (!open) setEditingSpaceId(null);
          }}
          onSave={(patch) => updateSpace(editingSpace.id, patch)}
        />
      ) : null}
    </div>
  );
});
