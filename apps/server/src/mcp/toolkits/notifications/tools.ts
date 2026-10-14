import {
  OrchestratorMcpFailure,
  UserNotificationInput,
  UserNotificationNotifyResult,
} from "@t3tools/contracts";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as UserNotifications from "../../../notifications/UserNotifications.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const NotifyUserTool = Tool.make("notify_user", {
  description: [
    "Send the user a notification: it lands in their inbox in T3 Code and, unless quiet, pushes to their phone.",
    "Pick the priority by how much it needs them.",
    "`urgent`: needs them now (a flag, a decision only they can make, work blocked on them); it alerts loudly.",
    "`normal` (default): finished work worth a glance.",
    "`quiet`: inbox only, no push; use it for anything they can read later.",
    "Write `title` as the headline and `body` as one or two plain sentences, with no markdown.",
    "`link` is where a tap goes: an https URL such as a report, or an in-app path.",
    "`tag` collapses repeats: a later call with the same tag replaces the earlier notification instead of adding another (for example `flag:topic:2026-10-14`).",
    "Do not use it for progress chatter; the thread status card already covers that.",
  ].join(" "),
  parameters: UserNotificationInput,
  success: UserNotificationNotifyResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [McpInvocationContext.McpInvocationContext, UserNotifications.UserNotifications],
})
  .annotate(Tool.Title, "Notify the user")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const NotificationsToolkit = Toolkit.make(NotifyUserTool);
