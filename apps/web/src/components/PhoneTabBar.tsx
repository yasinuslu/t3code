import { useParams } from "@tanstack/react-router";
import { InboxIcon, ListIcon, MessagesSquareIcon, SproutIcon, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildWorkOverview } from "@t3tools/client-runtime/state/work-overview";

import { type AppMode, setAppMode, useAppMode } from "../appMode";
import { useHomeThreadShells, useIsManagerThread, useManagerProfile } from "../brainstormStore";
import { useIsMobile } from "../hooks/useMediaQuery";
import { goToManager } from "../lib/goToManager";
import { cn } from "../lib/utils";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useOpenManagerThreadPage } from "./brainstorm/useOpenManagerThread";
import { useSidebar } from "./ui/sidebar";

type PhoneTab = "needs-you" | "manager" | "grow" | "threads";

const TABS: ReadonlyArray<{
  readonly tab: PhoneTab;
  readonly label: string;
  readonly icon: LucideIcon;
}> = [
  { tab: "needs-you", label: "Needs you", icon: InboxIcon },
  { tab: "manager", label: "Manager", icon: MessagesSquareIcon },
  { tab: "grow", label: "Grow", icon: SproutIcon },
  { tab: "threads", label: "Threads", icon: ListIcon },
];

/** Needs-you count, kept off the bar's render path until the count itself changes. */
function useNeedsYouCount(): number {
  const threads = useHomeThreadShells();
  return useMemo(() => buildWorkOverview(threads, Date.now()).needsMe.length, [threads]);
}

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

function activeTabOf(mode: AppMode, onManagerThread: boolean): PhoneTab {
  if (mode === "grow") return "grow";
  if (mode === "classic") return "needs-you";
  return onManagerThread ? "manager" : "threads";
}

/**
 * The phone's way between the app's screens, replacing the top mode switch:
 * Needs you (Home's cards), the Manager chat, Grow, and the thread list.
 * Below `md` only; index.css reserves its room while it is mounted.
 */
export function PhoneTabBar() {
  const isMobile = useIsMobile();
  const mode = useAppMode();
  const needsYou = useNeedsYouCount();
  const managerProfile = useManagerProfile();
  const openManagerThreadPage = useOpenManagerThreadPage();
  const { setOpenMobile } = useSidebar();
  const route = useParams({ strict: false, select: (params) => resolveThreadRouteRef(params) });
  const onManagerThread = useIsManagerThread(route?.environmentId ?? "", route?.threadId ?? "");
  const keyboardUp = useKeyboardUp();

  if (!isMobile || keyboardUp) return null;
  const active = activeTabOf(mode, onManagerThread);

  const select = (tab: PhoneTab) => {
    if (tab === "grow") setAppMode("grow");
    else if (tab === "needs-you") setAppMode("classic");
    else if (tab === "manager") void goToManager(() => openManagerThreadPage(managerProfile));
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
      {TABS.map(({ tab, label, icon: Icon }) => (
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
            {tab === "needs-you" && needsYou > 0 ? (
              <span className="absolute -top-1 left-full ms-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-3xs leading-4 text-primary-foreground">
                {needsYou}
              </span>
            ) : null}
          </span>
          <span className="max-w-full truncate">{label}</span>
        </button>
      ))}
    </nav>
  );
}
