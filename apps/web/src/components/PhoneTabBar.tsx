import { useParams } from "@tanstack/react-router";
import { ListIcon, MessagesSquareIcon, SproutIcon, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { type AppMode, backToGrow, setAppMode, useAppMode } from "../appMode";
import { useIsManagerThread } from "../brainstormStore";
import { useIsMobile } from "../hooks/useMediaQuery";
import { toggleManager } from "../lib/goToManager";
import { cn } from "../lib/utils";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useGrowIsHome } from "../hooks/useSettings";
import { useGrowShowsManager } from "./grow/GrowReturns";
import { useSidebar } from "./ui/sidebar";

type PhoneTab = "manager" | "grow" | "threads";

const TABS: ReadonlyArray<{
  readonly tab: PhoneTab;
  readonly label: string;
  readonly icon: LucideIcon;
}> = [
  { tab: "manager", label: "Manager", icon: MessagesSquareIcon },
  { tab: "grow", label: "Grow", icon: SproutIcon },
  { tab: "threads", label: "Threads", icon: ListIcon },
];

/**
 * The on-screen keyboard is up: a text field has focus and the visual viewport is much
 * shorter than the tallest one seen at this width. Focus alone is not enough, because
 * the manager and draft composers are focused by script without any keyboard opening.
 */
function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let tallest = viewport.height;
    let width = window.innerWidth;
    const sync = () => {
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        tallest = 0;
      }
      tallest = Math.max(tallest, viewport.height, window.innerHeight);
      const active = document.activeElement;
      const typing =
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active instanceof HTMLTextAreaElement ||
          (active instanceof HTMLInputElement &&
            !["button", "checkbox", "radio", "submit", "range"].includes(active.type)));
      setUp(typing && viewport.height < tallest * 0.75);
    };
    viewport.addEventListener("resize", sync);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    sync();
    return () => {
      viewport.removeEventListener("resize", sync);
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
    };
  }, []);
  return up;
}

function activeTabOf(mode: AppMode, managerShown: boolean, growManager: boolean): PhoneTab {
  if (mode === "grow") return growManager ? "manager" : "grow";
  return managerShown ? "manager" : "threads";
}

/**
 * The phone's way between the app's screens, replacing the top mode switch:
 * the Manager chat (shown over the screen), Grow, and the thread list.
 * Below `md` only; index.css reserves its room while it is mounted.
 */
export function PhoneTabBar() {
  const isMobile = useIsMobile();
  const mode = useAppMode();
  const { setOpenMobile } = useSidebar();
  const route = useParams({ strict: false, select: (params) => resolveThreadRouteRef(params) });
  const onManagerThread = useIsManagerThread(route?.environmentId ?? "", route?.threadId ?? "");
  const keyboardUp = useKeyboardUp();
  const growIsHome = useGrowIsHome();
  const growManager = useGrowShowsManager();

  if (!isMobile || keyboardUp) return null;
  const active = activeTabOf(mode, onManagerThread, growManager);
  // Grow has its own list, so the thread list is only a tab in the classic threads view.
  const tabs = growIsHome ? TABS.filter((entry) => entry.tab !== "threads") : TABS;

  const select = (tab: PhoneTab) => {
    if (tab === "grow") {
      if (mode === "grow" && growManager) toggleManager();
      else if (growIsHome) backToGrow(route);
      else setAppMode("grow");
    } else if (tab === "manager") toggleManager();
    else {
      // The list is the point of this tab: show it, over whichever thread is open.
      setAppMode("normal");
      setOpenMobile(true);
    }
  };

  return (
    // Under the sidebar drawer's sheet (--z-sheet) so the drawer covers it, above Home (z-40).
    <nav
      aria-label="Screens"
      data-mode-switch=""
      data-phone-tabbar-bar=""
      className="fixed inset-x-0 bottom-0 z-45 flex border-t bg-background pb-safe"
    >
      {tabs.map(({ tab, label, icon: Icon }) => (
        <button
          key={tab}
          type="button"
          aria-current={active === tab ? "page" : undefined}
          data-phone-tab={tab}
          className={cn(
            "relative flex h-14 min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors active:bg-accent",
            active === tab ? "text-primary" : "text-muted-foreground",
          )}
          onClick={() => select(tab)}
        >
          <span className="relative">
            <Icon className="size-5" aria-hidden />
          </span>
          <span className="max-w-full truncate">{label}</span>
        </button>
      ))}
    </nav>
  );
}
