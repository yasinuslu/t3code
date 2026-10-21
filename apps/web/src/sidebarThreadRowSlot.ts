import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ReactNode } from "react";
import { create } from "zustand";

/** How a view outside the sidebar shows one of its thread rows. */
export interface ExternalThreadRowOptions {
  readonly isActive: boolean;
  /** Replaces opening the thread: the host view selects it instead. */
  readonly onSelect: () => void;
  readonly accessory?: ReactNode;
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
