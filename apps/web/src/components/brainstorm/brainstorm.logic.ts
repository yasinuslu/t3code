import type {
  BrainstormSpace,
  BrainstormSyncSpacesInput,
  KeybindingShortcut,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";

import { ALL_SPACE_ID, OTHER_SPACE_ID, type Space, type SpaceState } from "../../spaceStore";

export const BRAINSTORM_TOGGLE_COMMAND = "brainstorm.toggle";

/** The client's spaces as the server mirrors them for the brainstorm tools. */
export function brainstormSpacesInput(
  state: Pick<SpaceState, "spaces" | "customSpaceIdsByProjectKey">,
  environmentId: string,
  defaultProfile: string | null = null,
): BrainstormSyncSpacesInput {
  const spaces: BrainstormSpace[] = state.spaces.map((space: Space) => ({
    id: space.id,
    name: space.name,
    kind:
      space.id === ALL_SPACE_ID
        ? "all"
        : space.id === OTHER_SPACE_ID
          ? "other"
          : space.profile !== null
            ? "profile"
            : "custom",
    profile: space.profile,
  }));
  const prefix = `${environmentId}:`;
  const customSpaceIdsByProjectId: Record<string, ReadonlyArray<string>> = {};
  for (const [key, spaceIds] of Object.entries(state.customSpaceIdsByProjectKey)) {
    if (key.startsWith(prefix) && spaceIds.length > 0) {
      customSpaceIdsByProjectId[key.slice(prefix.length)] = spaceIds;
    }
  }
  return { spaces, customSpaceIdsByProjectId, defaultProfile };
}

/**
 * The membership changes that make the client's view of one environment's
 * custom spaces match the server's, as `[projectKey, spaceId, member]`.
 */
export function membershipChangesToAdopt(
  clientByProjectKey: Readonly<Record<string, ReadonlyArray<string>>>,
  serverByProjectId: Readonly<Record<string, ReadonlyArray<string>>>,
  environmentId: string,
): Array<[string, string, boolean]> {
  const prefix = `${environmentId}:`;
  const changes: Array<[string, string, boolean]> = [];
  const projectIds = new Set([
    ...Object.keys(serverByProjectId),
    ...Object.keys(clientByProjectKey)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length)),
  ]);
  for (const projectId of projectIds) {
    const key = `${prefix}${projectId}`;
    const client = new Set(clientByProjectKey[key] ?? []);
    const server = new Set(serverByProjectId[projectId] ?? []);
    for (const spaceId of server) if (!client.has(spaceId)) changes.push([key, spaceId, true]);
    for (const spaceId of client) if (!server.has(spaceId)) changes.push([key, spaceId, false]);
  }
  return changes;
}

const ACCELERATOR_KEYS: Readonly<Record<string, string>> = {
  " ": "Space",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  escape: "Escape",
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  "+": "Plus",
};

/**
 * An Electron accelerator for a shortcut, or null when it has no modifier
 * (a bare key must never be taken from every other app).
 */
export function shortcutToAccelerator(shortcut: KeybindingShortcut): string | null {
  const modifiers: string[] = [];
  if (shortcut.modKey) modifiers.push("CommandOrControl");
  if (shortcut.metaKey) modifiers.push("Super");
  if (shortcut.ctrlKey) modifiers.push("Control");
  if (shortcut.altKey) modifiers.push("Alt");
  if (shortcut.shiftKey) modifiers.push("Shift");
  if (modifiers.length === 0) return null;
  const key =
    ACCELERATOR_KEYS[shortcut.key] ??
    (/^f\d{1,2}$/.test(shortcut.key) ? shortcut.key.toUpperCase() : null) ??
    (shortcut.key.length === 1 ? shortcut.key.toUpperCase() : null);
  return key === null ? null : [...modifiers, key].join("+");
}

/** The accelerator of the command's effective (last, unconditional) binding. */
export function brainstormAccelerator(keybindings: ResolvedKeybindingsConfig): string | null {
  const rule = keybindings.findLast(
    (entry) => entry.command === BRAINSTORM_TOGGLE_COMMAND && entry.whenAst === undefined,
  );
  return rule ? shortcutToAccelerator(rule.shortcut) : null;
}

export interface ToolStep {
  readonly id: string;
  readonly label: string;
  readonly done: boolean;
  readonly at: string;
}

/**
 * One line per tool call, from the thread's tool activities: the last update
 * of each call wins, labelled with the tool's name (MCP prefixes dropped).
 */
export function toolStepsOf(
  activities: ReadonlyArray<{
    readonly id: string;
    readonly tone: string;
    readonly kind: string;
    readonly summary: string;
    readonly payload: unknown;
    readonly createdAt: string;
  }>,
): ReadonlyArray<ToolStep> {
  const steps = new Map<string, ToolStep>();
  for (const activity of activities) {
    if (activity.tone !== "tool") continue;
    const payload = (activity.payload ?? {}) as {
      readonly toolCallId?: unknown;
      readonly detail?: unknown;
      readonly data?: { readonly toolName?: unknown };
    };
    const callId = typeof payload.toolCallId === "string" ? payload.toolCallId : activity.id;
    const rawName =
      typeof payload.data?.toolName === "string" ? payload.data.toolName : activity.summary;
    const name = rawName.replace(/^mcp__[^_]+(?:-[^_]+)*__/, "");
    const detail =
      typeof payload.detail === "string" ? payload.detail.replace(/^[^:]*:\s*/, "") : "";
    const label = detail && detail !== "{}" ? `${name} ${detail}` : name;
    const first = steps.get(callId);
    steps.set(callId, {
      id: callId,
      label: label.length > 140 ? `${label.slice(0, 139)}…` : label,
      done: activity.kind === "tool.completed",
      at: first?.at ?? activity.createdAt,
    });
  }
  return [...steps.values()];
}
