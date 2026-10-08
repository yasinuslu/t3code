import {
  ModelSelection,
  OrchestratorMcpFailure,
  OrchestratorMcpThreadLink,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as PeerEnvironments from "../../../peers/PeerEnvironments.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ThreadStatus } from "../brainstorm/tools.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [McpInvocationContext.McpInvocationContext, PeerEnvironments.PeerEnvironments],
};

const REACH =
  "Peers are other T3 Code servers configured on this server with `t3 peer add`. Manager thread only. Threads on this server use the normal t3_thread_* tools.";

const PeerInput = Schema.String.annotate({ description: "Peer name from t3_peer_list." });

const PeerThread = Schema.Struct({
  threadId: Schema.String,
  title: Schema.String,
  link: OrchestratorMcpThreadLink,
  status: ThreadStatus,
  project: Schema.String,
  projectId: Schema.String,
  lastActivityAt: Schema.String,
  branch: Schema.NullOr(Schema.String),
});

const readonlyTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, true) as T;

const PeerListTool = readonlyTool(
  Tool.make("t3_peer_list", {
    ...shared,
    description: `List the peer T3 servers this server can reach, with whether each answers right now. ${REACH}`,
    success: Schema.Struct({
      peers: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          url: Schema.String,
          reachable: Schema.Boolean,
          label: Schema.NullOr(Schema.String),
          environmentId: Schema.NullOr(Schema.String),
          serverVersion: Schema.NullOr(Schema.String),
        }),
      ),
    }),
  }).annotate(Tool.Title, "List peer servers"),
);

const PeerThreadListTool = readonlyTool(
  Tool.make("t3_peer_thread_list", {
    ...shared,
    description: `List a peer's active top-level threads, most recent activity first, with a one-word status. ${REACH}`,
    parameters: Schema.Struct({
      peer: PeerInput,
      limit: Schema.optional(Schema.Int.annotate({ description: "Default 30." })),
    }),
    success: Schema.Struct({ threads: Schema.Array(PeerThread) }),
  }).annotate(Tool.Title, "List a peer's threads"),
);

const PeerProjectListTool = readonlyTool(
  Tool.make("t3_peer_project_list", {
    ...shared,
    description: `List a peer's projects, for t3_peer_thread_launch. ${REACH}`,
    parameters: Schema.Struct({ peer: PeerInput }),
    success: Schema.Struct({
      projects: Schema.Array(
        Schema.Struct({
          projectId: Schema.String,
          title: Schema.String,
          workspaceRoot: Schema.String,
        }),
      ),
    }),
  }).annotate(Tool.Title, "List a peer's projects"),
);

const PeerThreadReadTool = readonlyTool(
  Tool.make("t3_peer_thread_read", {
    ...shared,
    description: `Read a thread on a peer: its status and last messages (each cut to 4,000 characters). ${REACH}`,
    parameters: Schema.Struct({
      peer: PeerInput,
      threadId: Schema.String,
      messages: Schema.optional(
        Schema.Int.annotate({ description: "How many recent messages. Default 10, at most 50." }),
      ),
    }),
    success: Schema.Struct({
      threadId: Schema.String,
      title: Schema.String,
      link: OrchestratorMcpThreadLink,
      status: ThreadStatus,
      messages: Schema.Array(
        Schema.Struct({
          role: Schema.String,
          text: Schema.String,
          truncated: Schema.Boolean,
          createdAt: Schema.String,
        }),
      ),
    }),
  }).annotate(Tool.Title, "Read a peer thread"),
);

const PeerThreadLaunchTool = Tool.make("t3_peer_thread_launch", {
  ...shared,
  description: `Start a thread on a peer with a first message. Without modelSelection it uses the project's default model, else the model of the project's latest thread. workspace=worktree needs baseRef. ${REACH}`,
  parameters: Schema.Struct({
    peer: PeerInput,
    projectId: Schema.String.annotate({ description: "From t3_peer_project_list." }),
    title: Schema.String,
    message: Schema.String.annotate({ description: "The full brief." }),
    modelSelection: Schema.optional(ModelSelection),
    runtimeMode: Schema.optional(RuntimeMode),
    interactionMode: Schema.optional(ProviderInteractionMode),
    workspace: Schema.optional(Schema.Literals(["root", "worktree"])),
    branch: Schema.optional(Schema.String),
    baseRef: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ threadId: Schema.String, link: OrchestratorMcpThreadLink }),
})
  .annotate(Tool.Title, "Launch a peer thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const PeerThreadSendTool = Tool.make("t3_peer_thread_send", {
  ...shared,
  description: `Send a message to a thread on a peer. It starts an idle thread or queues behind the running turn. ${REACH}`,
  parameters: Schema.Struct({
    peer: PeerInput,
    threadId: Schema.String,
    message: Schema.String,
  }),
  success: Schema.Struct({ threadId: Schema.String }),
})
  .annotate(Tool.Title, "Send to a peer thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const PeersToolkit = Toolkit.make(
  PeerListTool,
  PeerThreadListTool,
  PeerProjectListTool,
  PeerThreadReadTool,
  PeerThreadLaunchTool,
  PeerThreadSendTool,
);
