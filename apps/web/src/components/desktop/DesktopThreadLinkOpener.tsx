import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Desktop only. A `t3code://threads/<env>/<thread>` link clicked outside the app
 * (a browser, a terminal, an older client) reaches the OS handler, and the shell
 * forwards it here so the running window navigates in place instead of reloading.
 * The thread route reports an unknown environment or thread the same way a chip does.
 */
export function DesktopThreadLinkOpener() {
  const navigate = useNavigate();
  useEffect(() => {
    const subscribe = window.desktopBridge?.onOpenThreadLink;
    if (typeof subscribe !== "function") return;
    return subscribe((href) => {
      const target = parseThreadLinkHref(href);
      if (!target) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: target.environmentId, threadId: target.threadId },
      });
    });
  }, [navigate]);
  return null;
}
