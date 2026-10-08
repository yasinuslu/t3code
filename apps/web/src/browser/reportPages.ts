/**
 * Report pages: one-screen HTML pages (made by the nep:html-report skill) that
 * are designed for a fixed desktop viewport. They open as a preview browser tab
 * at that viewport, scaled to fill the maximized right panel, so the whole page
 * lands at its design proportions on first open.
 *
 * A page opts in with `<meta name="nep-report">` in its head.
 */
import type { PreviewViewportSetting } from "@t3tools/contracts";
import { create } from "zustand";

export const REPORT_DESIGN_VIEWPORT = {
  _tag: "freeform",
  width: 1440,
  height: 900,
} as const satisfies PreviewViewportSetting;

const REPORT_MARKER = /<meta\s[^>]*name\s*=\s*["']?nep-report["'\s>/]/i;

export const isReportPage = (html: string): boolean => REPORT_MARKER.test(html);

interface ReportPagesState {
  /** Server tab ids of preview tabs showing a report; they may scale above 1x. */
  readonly tabIds: ReadonlySet<string>;
  /** Thread key whose right panel a report open asked to maximize. */
  readonly maximizeRequest: { readonly threadKey: string; readonly id: number } | null;
  readonly markReportTab: (tabId: string) => void;
  readonly requestMaximize: (threadKey: string) => void;
}

export const useReportPagesStore = create<ReportPagesState>()((set) => ({
  tabIds: new Set(),
  maximizeRequest: null,
  markReportTab: (tabId) =>
    set((state) =>
      state.tabIds.has(tabId) ? state : { tabIds: new Set([...state.tabIds, tabId]) },
    ),
  requestMaximize: (threadKey) =>
    set((state) => ({ maximizeRequest: { threadKey, id: (state.maximizeRequest?.id ?? 0) + 1 } })),
}));
