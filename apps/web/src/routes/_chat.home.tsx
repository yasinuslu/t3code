import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { openHomeOverlay } from "../homeOverlayStore";

/** Home is an overlay, not a page: /home opens it over the start page. */
function HomeRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    openHomeOverlay();
    void navigate({ to: "/", replace: true });
  }, [navigate]);
  return null;
}

export const Route = createFileRoute("/_chat/home")({
  component: HomeRedirect,
});
