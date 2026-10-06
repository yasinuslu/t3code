import { createFileRoute } from "@tanstack/react-router";

import { HomeDashboard } from "../components/home/HomeDashboard";

export const Route = createFileRoute("/_chat/home")({
  component: HomeDashboard,
});
