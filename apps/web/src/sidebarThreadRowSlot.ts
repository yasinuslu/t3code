import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ReactNode } from "react";
import { create } from "zustand";

/** How a view outside the sidebar shows one of its thread rows. */
export interface ExternalThreadRowOptions {
  readonly isActive: boolean;
  /** Replaces opening the thread: the host view selects it instead. */
  readonly onSelect: () => void;
  /** The host's one state mark, leading the row (Grow: working, needs you, shipped, playable). */
  readonly mark?: ReactNode;
  /** The quiet line under the title (Grow: project · branch). */
  readonly subtitle?: string | null;
  /** Host marks that matter less: shown only while the row is hovered or focused. */
  readonly details?: ReactNode;
}

type RenderThreadRow = (
  thread: EnvironmentThreadShell,
  options: ExternalThreadRowOptions,
) => ReactNode;

/**
 * The sidebar's own thread row, lent to other views (Grow) with its status, actions, rename and
 * context menu wired as in the sidebar. The sidebar publishes it while mounted; null otherwise,
 * and the view falls back to its own row.
 */
export const useSidebarThreadRowSlot = create<{ readonly render: RenderThreadRow | null }>(() => ({
  render: null,
}));
