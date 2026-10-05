import { createFileRoute } from "@tanstack/react-router";

import { ManagerScreen } from "../components/brainstorm/ManagerScreen";

export const Route = createFileRoute("/_chat/manager")({
  component: ManagerScreen,
});
