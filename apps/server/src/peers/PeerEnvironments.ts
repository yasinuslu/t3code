/**
 * Other T3 servers ("peers") this server can reach on the user's behalf.
 *
 * A peer is provisioned once with `t3 peer add`: its HTTP base URL and a
 * bearer token issued on that peer (`t3 auth session issue`). Both live in the
 * server's secret store. Every operation opens one authenticated WebSocket RPC
 * connection, does its calls and closes it, so an offline peer costs nothing
 * until it is asked for.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  CommandId,
  type EnvironmentId,
  ExecutionEnvironmentDescriptor,
  MessageId,
  type ModelSelection,
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
  ORCHESTRATION_V2_WS_METHODS,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
  ThreadId,
  WsRpcGroup,
} from "@t3tools/contracts";
import { formatThreadMarkdownLink } from "@t3tools/shared/threadLinks";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { lastActivityOf, threadStatusOf } from "../mcp/toolkits/brainstorm/handlers.ts";

const PEER_ENVIRONMENTS_SECRET = "peer-environments";

const DESCRIPTOR_PATH = "/.well-known/t3/environment";
const DESCRIPTOR_TIMEOUT = Duration.seconds(4);
const SOCKET_OPEN_TIMEOUT = Duration.seconds(5);
const RPC_TIMEOUT = Duration.seconds(60);
const MESSAGE_MAX_CHARS = 4_000;

export const PeerEnvironment = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
  token: Schema.String,
});
export type PeerEnvironment = typeof PeerEnvironment.Type;

const PeerEnvironmentsJson = Schema.fromJsonString(Schema.Array(PeerEnvironment));
const decodePeers = Schema.decodeEffect(PeerEnvironmentsJson);
const encodePeers = Schema.encodeEffect(PeerEnvironmentsJson);

export class PeerNotFoundError extends Schema.TaggedError<PeerNotFoundError>()(
  "PeerNotFoundError",
  { name: Schema.String },
) {
  override get message(): string {
    return `No peer named "${this.name}". Configure one with \`t3 peer add\`.`;
  }
}

export class PeerUnreachableError extends Schema.TaggedError<PeerUnreachableError>()(
  "PeerUnreachableError",
  { name: Schema.String, url: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return `${this.name} is offline or unreachable (${this.url}).`;
  }
}

export class PeerRequestError extends Schema.TaggedError<PeerRequestError>()("PeerRequestError", {
  name: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `${this.name}: ${this.detail}`;
  }
}

export class PeerInvalidUrlError extends Schema.TaggedError<PeerInvalidUrlError>()(
  "PeerInvalidUrlError",
  { url: Schema.String },
) {
  override get message(): string {
    return `"${this.url}" is not an http(s) base URL, for example http://host:3773.`;
  }
}

export class PeerStoreError extends Schema.TaggedError<PeerStoreError>()("PeerStoreError", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return "Could not read or write the peer list in the server's secret store.";
  }
}

export type PeerError =
  | PeerNotFoundError
  | PeerUnreachableError
  | PeerRequestError
  | PeerInvalidUrlError
  | PeerStoreError;

export type PeerThreadStatus = ReturnType<typeof threadStatusOf>;

export interface PeerThreadEntry {
  readonly threadId: string;
  readonly title: string;
  readonly link: string;
  readonly status: PeerThreadStatus;
  readonly project: string;
  readonly projectId: string;
  readonly lastActivityAt: string;
  readonly branch: string | null;
}

export interface PeerProjectEntry {
  readonly projectId: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

export interface PeerMessage {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly truncated: boolean;
  readonly createdAt: string;
}

export interface PeerStatus {
  readonly name: string;
  readonly url: string;
  readonly reachable: boolean;
  readonly label: string | null;
  readonly environmentId: string | null;
  readonly serverVersion: string | null;
}

export interface PeerLaunchInput {
  readonly projectId: string;
  readonly title: string;
  readonly text: string;
  readonly modelSelection?: ModelSelection | undefined;
  readonly runtimeMode?: RuntimeMode | undefined;
  readonly interactionMode?: ProviderInteractionMode | undefined;
  readonly workspace?: "root" | "worktree" | undefined;
  readonly branch?: string | undefined;
  readonly baseRef?: string | undefined;
}

// ---------------------------------------------------------------------------
// Pure helpers

/** The peer's HTTP base URL without a trailing slash, or null when it is not http(s). */
export function normalizePeerUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** The authenticated WebSocket RPC endpoint behind a peer's HTTP base URL. */
export function peerSocketUrl(baseUrl: string): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set(ORCHESTRATION_PROTOCOL_QUERY_PARAM, String(ORCHESTRATION_PROTOCOL_VERSION));
  url.searchParams.set("clientSurface", "web");
  return url.toString();
}

/** Adds the peer, replacing one with the same name. */
function upsertPeer(
  peers: ReadonlyArray<PeerEnvironment>,
  peer: PeerEnvironment,
): ReadonlyArray<PeerEnvironment> {
  const index = peers.findIndex((candidate) => candidate.name === peer.name);
  if (index === -1) return [...peers, peer];
  return peers.map((candidate, at) => (at === index ? peer : candidate));
}

const isTopLevel = (thread: OrchestrationV2ThreadShell) =>
  thread.deletedAt === null &&
  thread.archivedAt === null &&
  thread.lineage.relationshipToParent !== "subagent";

/** A peer's active top-level threads, most recent first. */
export function peerThreadEntries(
  snapshot: Pick<OrchestrationV2ShellSnapshot, "threads" | "projects">,
  environmentId: EnvironmentId,
  limit: number,
): ReadonlyArray<PeerThreadEntry> {
  return snapshot.threads
    .filter(isTopLevel)
    .map((thread) => ({ thread, lastActivityAt: lastActivityOf(thread) }))
    .toSorted((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))
    .slice(0, Math.max(0, limit))
    .map(({ thread, lastActivityAt }) => ({
      threadId: thread.id,
      title: thread.title,
      link: formatThreadMarkdownLink({ environmentId, threadId: thread.id, title: thread.title }),
      status: threadStatusOf(thread),
      project:
        snapshot.projects.find((project) => project.id === thread.projectId)?.title ??
        thread.projectId,
      projectId: thread.projectId,
      lastActivityAt,
      branch: thread.branch,
    }));
}

/** The last `count` conversation messages, each cut to a readable size. */
export function peerMessages(
  projection: Pick<OrchestrationV2ThreadProjection, "messages">,
  count: number,
): ReadonlyArray<PeerMessage> {
  return projection.messages.slice(-Math.max(1, count)).map((message) => {
    const characters = Array.from(message.text);
    return {
      role: message.role,
      text: characters.slice(0, MESSAGE_MAX_CHARS).join(""),
      truncated: characters.length > MESSAGE_MAX_CHARS,
      createdAt: DateTime.formatIso(message.createdAt),
    };
  });
}

/** What model a launch on the peer uses when none is given: the project's default, else its latest thread's. */
export function defaultLaunchModel(
  snapshot: Pick<OrchestrationV2ShellSnapshot, "threads" | "projects">,
  projectId: string,
): ModelSelection | null {
  const project = snapshot.projects.find((candidate) => candidate.id === projectId);
  if (project?.defaultModelSelection) return project.defaultModelSelection;
  const latest = snapshot.threads
    .filter((thread) => thread.projectId === projectId && thread.deletedAt === null)
    .toSorted((left, right) => lastActivityOf(right).localeCompare(lastActivityOf(left)))
    .at(0);
  return latest?.modelSelection ?? null;
}

export function launchWorkspaceStrategy(
  input: Pick<PeerLaunchInput, "workspace" | "branch" | "baseRef">,
): OrchestrationV2ThreadLaunchWorkspaceStrategy | null {
  const branch = input.branch?.trim() ? { branch: input.branch.trim() } : {};
  if (input.workspace === "worktree") {
    const baseRef = input.baseRef?.trim();
    return baseRef ? { type: "worktree", baseRef, ...branch } : null;
  }
  return { type: "root", ...branch };
}

const describeCause = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = (cause as { readonly message: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return String(cause);
};

// ---------------------------------------------------------------------------
// Service

export class PeerEnvironments extends Context.Service<
  PeerEnvironments,
  {
    /** Configured peers, without their tokens. */
    readonly list: Effect.Effect<
      ReadonlyArray<{ readonly name: string; readonly url: string }>,
      PeerStoreError
    >;
    /** Each configured peer with its live descriptor, best effort. */
    readonly status: Effect.Effect<ReadonlyArray<PeerStatus>, PeerStoreError>;
    /** Checks a peer's URL and token without saving it: its descriptor and thread count. */
    readonly verify: (peer: PeerEnvironment) => Effect.Effect<
      {
        readonly descriptor: ExecutionEnvironmentDescriptor;
        readonly threadCount: number;
      },
      PeerUnreachableError | PeerRequestError | PeerInvalidUrlError
    >;
    readonly add: (
      peer: PeerEnvironment,
    ) => Effect.Effect<void, PeerStoreError | PeerInvalidUrlError>;
    /** False when no peer had that name. */
    readonly remove: (name: string) => Effect.Effect<boolean, PeerStoreError>;
    readonly threads: (
      name: string,
      options: { readonly limit: number },
    ) => Effect.Effect<ReadonlyArray<PeerThreadEntry>, PeerError>;
    readonly projects: (name: string) => Effect.Effect<ReadonlyArray<PeerProjectEntry>, PeerError>;
    readonly readThread: (
      name: string,
      threadId: string,
      options: { readonly messages: number },
    ) => Effect.Effect<
      {
        readonly threadId: string;
        readonly title: string;
        readonly link: string;
        readonly status: PeerThreadStatus;
        readonly messages: ReadonlyArray<PeerMessage>;
      },
      PeerError
    >;
    readonly launch: (
      name: string,
      input: PeerLaunchInput,
    ) => Effect.Effect<{ readonly threadId: string; readonly link: string }, PeerError>;
    readonly send: (
      name: string,
      threadId: string,
      text: string,
    ) => Effect.Effect<{ readonly threadId: string }, PeerError>;
  }
>()("t3/peers/PeerEnvironments") {}

const makeRpcClient = RpcClient.make(WsRpcGroup);
type PeerRpcClient = Effect.Success<typeof makeRpcClient>;

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const crypto = yield* Crypto.Crypto;

  const readPeers = Effect.suspend(() => secrets.get(PEER_ENVIRONMENTS_SECRET)).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed<ReadonlyArray<PeerEnvironment>>([]),
        onSome: (bytes) => decodePeers(new TextDecoder().decode(bytes)),
      }),
    ),
    Effect.mapError((cause) => new PeerStoreError({ cause })),
  );

  const writePeers = (peers: ReadonlyArray<PeerEnvironment>) =>
    encodePeers(peers).pipe(
      Effect.flatMap((json) =>
        peers.length === 0
          ? secrets.remove(PEER_ENVIRONMENTS_SECRET)
          : secrets.set(PEER_ENVIRONMENTS_SECRET, new TextEncoder().encode(json)),
      ),
      Effect.mapError((cause) => new PeerStoreError({ cause })),
    );

  const findPeer = (name: string) =>
    readPeers.pipe(
      Effect.flatMap((peers) => {
        const peer = peers.find((candidate) => candidate.name === name);
        return peer ? Effect.succeed(peer) : Effect.fail(new PeerNotFoundError({ name }));
      }),
    );

  const fetchDescriptor = (peer: Pick<PeerEnvironment, "name" | "url">) =>
    httpClient.execute(HttpClientRequest.get(`${peer.url}${DESCRIPTOR_PATH}`)).pipe(
      Effect.timeout(DESCRIPTOR_TIMEOUT),
      Effect.mapError(
        (cause) => new PeerUnreachableError({ name: peer.name, url: peer.url, cause }),
      ),
      Effect.flatMap((response) =>
        HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(ExecutionEnvironmentDescriptor)),
          Effect.mapError(
            (cause) =>
              new PeerRequestError({
                name: peer.name,
                detail: `${peer.url} did not answer as a T3 Code server.`,
                cause,
              }),
          ),
        ),
      ),
    );

  /** Runs `use` against one authenticated connection to the peer, then closes it. */
  const withClient = <A, E>(
    peer: PeerEnvironment,
    use: (client: PeerRpcClient) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | PeerUnreachableError> => {
    const authorization = `Bearer ${peer.token}`;
    const socketLayer = Socket.layerWebSocket(peerSocketUrl(peer.url), {
      openTimeout: SOCKET_OPEN_TIMEOUT,
    }).pipe(
      Layer.provide(
        Layer.succeed(
          Socket.WebSocketConstructor,
          (url) => new NodeSocket.NodeWS.WebSocket(url, { headers: { authorization } }),
        ),
      ),
    );
    const protocolLayer = RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
      Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)),
    );
    return Effect.scoped(
      Effect.gen(function* () {
        const protocol = yield* Layer.build(protocolLayer);
        const client = yield* makeRpcClient.pipe(Effect.provide(protocol));
        return yield* use(client);
      }),
    ).pipe(
      Effect.timeoutOrElse({
        duration: RPC_TIMEOUT,
        orElse: () => Effect.fail(new PeerUnreachableError({ name: peer.name, url: peer.url })),
      }),
    );
  };

  const rpcFailure = (peer: PeerEnvironment, operation: string) => (cause: unknown) => {
    const reason = describeCause(cause);
    // The descriptor answered, so a refused upgrade almost always means the token.
    const hint = reason.includes("SocketOpenError")
      ? " The peer refused the connection; its token may be invalid or revoked. Run `t3 peer add` again with a fresh token."
      : "";
    return new PeerRequestError({
      name: peer.name,
      detail: `${operation} failed: ${reason}.${hint}`,
      cause,
    });
  };

  const shellSnapshot = (peer: PeerEnvironment, client: PeerRpcClient) =>
    client[ORCHESTRATION_V2_WS_METHODS.subscribeShell]({}).pipe(
      Stream.filter((item) => item.kind === "snapshot"),
      Stream.runHead,
      Effect.mapError(rpcFailure(peer, "Reading threads")),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new PeerRequestError({
                name: peer.name,
                detail: "The thread list stream ended early.",
              }),
            ),
          onSome: (item) => Effect.succeed(item.snapshot),
        }),
      ),
    );

  const threadShell = (snapshot: OrchestrationV2ShellSnapshot, threadId: string) =>
    snapshot.threads.find((thread) => thread.id === threadId) ??
    snapshot.archivedThreads.find((thread) => thread.id === threadId);

  const newId = crypto.randomUUIDv4.pipe(Effect.orDie);

  const validated = (peer: PeerEnvironment) => {
    const url = normalizePeerUrl(peer.url);
    return url === null
      ? Effect.fail(new PeerInvalidUrlError({ url: peer.url }))
      : Effect.succeed({ name: peer.name.trim(), url, token: peer.token.trim() });
  };

  return PeerEnvironments.of({
    list: readPeers.pipe(Effect.map((peers) => peers.map(({ name, url }) => ({ name, url })))),
    status: readPeers.pipe(
      Effect.flatMap((peers) =>
        Effect.forEach(
          peers,
          (peer) =>
            fetchDescriptor(peer).pipe(
              Effect.map((descriptor): PeerStatus => ({
                name: peer.name,
                url: peer.url,
                reachable: true,
                label: descriptor.label,
                environmentId: descriptor.environmentId,
                serverVersion: descriptor.serverVersion,
              })),
              Effect.orElseSucceed((): PeerStatus => ({
                name: peer.name,
                url: peer.url,
                reachable: false,
                label: null,
                environmentId: null,
                serverVersion: null,
              })),
            ),
          { concurrency: "unbounded" },
        ),
      ),
    ),
    verify: (input) =>
      Effect.gen(function* () {
        const peer = yield* validated(input);
        const descriptor = yield* fetchDescriptor(peer);
        const snapshot = yield* withClient(peer, (client) => shellSnapshot(peer, client));
        return { descriptor, threadCount: snapshot.threads.filter(isTopLevel).length };
      }),
    add: (input) =>
      Effect.gen(function* () {
        const peer = yield* validated(input);
        yield* writePeers(upsertPeer(yield* readPeers, peer));
      }),
    remove: (name) =>
      Effect.gen(function* () {
        const peers = yield* readPeers;
        const remaining = peers.filter((peer) => peer.name !== name);
        if (remaining.length === peers.length) return false;
        yield* writePeers(remaining);
        return true;
      }),
    threads: (name, { limit }) =>
      Effect.gen(function* () {
        const peer = yield* findPeer(name);
        const descriptor = yield* fetchDescriptor(peer);
        const snapshot = yield* withClient(peer, (client) => shellSnapshot(peer, client));
        return peerThreadEntries(snapshot, descriptor.environmentId, limit);
      }),
    projects: (name) =>
      Effect.gen(function* () {
        const peer = yield* findPeer(name);
        yield* fetchDescriptor(peer);
        const snapshot = yield* withClient(peer, (client) => shellSnapshot(peer, client));
        return snapshot.projects.map((project) => ({
          projectId: project.id,
          title: project.title,
          workspaceRoot: project.workspaceRoot,
        }));
      }),
    readThread: (name, threadId, { messages }) =>
      Effect.gen(function* () {
        const peer = yield* findPeer(name);
        const descriptor = yield* fetchDescriptor(peer);
        const { snapshot, projection } = yield* withClient(peer, (client) =>
          Effect.all({
            snapshot: shellSnapshot(peer, client),
            projection: client[ORCHESTRATION_V2_WS_METHODS.getThreadProjection]({
              threadId: ThreadId.make(threadId),
            }).pipe(Effect.mapError(rpcFailure(peer, `Reading thread ${threadId}`))),
          }),
        );
        const title = projection.thread.title;
        return {
          threadId,
          title,
          link: formatThreadMarkdownLink({
            environmentId: descriptor.environmentId,
            threadId: ThreadId.make(threadId),
            title,
          }),
          status: threadStatusOf(threadShell(snapshot, threadId)),
          messages: peerMessages(projection, messages),
        };
      }),
    launch: (name, input) =>
      Effect.gen(function* () {
        const peer = yield* findPeer(name);
        const workspaceStrategy = launchWorkspaceStrategy(input);
        if (workspaceStrategy === null) {
          return yield* new PeerRequestError({
            name,
            detail: "A worktree launch needs baseRef (for example main).",
          });
        }
        const descriptor = yield* fetchDescriptor(peer);
        const commandId = CommandId.make(yield* newId);
        const threadId = ThreadId.make(yield* newId);
        const launched = yield* withClient(peer, (client) =>
          Effect.gen(function* () {
            const snapshot = yield* shellSnapshot(peer, client);
            if (!snapshot.projects.some((project) => project.id === input.projectId)) {
              return yield* new PeerRequestError({
                name,
                detail: `No project ${input.projectId}; list them with t3_peer_project_list.`,
              });
            }
            const modelSelection =
              input.modelSelection ?? defaultLaunchModel(snapshot, input.projectId);
            if (modelSelection === null) {
              return yield* new PeerRequestError({
                name,
                detail:
                  "The project has no default model and no threads to copy one from; pass modelSelection.",
              });
            }
            return yield* client[ORCHESTRATION_V2_WS_METHODS.launchThread]({
              commandId,
              creationSource: "mcp",
              threadId,
              projectId: ProjectId.make(input.projectId),
              title: input.title,
              generateTitle: true,
              modelSelection,
              runtimeMode: input.runtimeMode ?? "full-access",
              interactionMode: input.interactionMode ?? "default",
              workspaceStrategy,
              initialMessage: { text: input.text, attachments: [] },
            }).pipe(Effect.mapError(rpcFailure(peer, "Launching the thread")));
          }),
        );
        return {
          threadId: launched.threadId,
          link: formatThreadMarkdownLink({
            environmentId: descriptor.environmentId,
            threadId: launched.threadId,
            title: launched.projection.thread.title,
          }),
        };
      }),
    send: (name, threadId, text) =>
      Effect.gen(function* () {
        const peer = yield* findPeer(name);
        yield* fetchDescriptor(peer);
        const commandId = CommandId.make(yield* newId);
        const messageId = MessageId.make(yield* newId);
        yield* withClient(peer, (client) =>
          client[ORCHESTRATION_V2_WS_METHODS.dispatchCommand]({
            type: "message.dispatch",
            createdBy: "user",
            creationSource: "mcp",
            commandId,
            threadId: ThreadId.make(threadId),
            messageId,
            text,
            attachments: [],
            dispatchMode: { type: "queue_after_active" },
          }).pipe(Effect.mapError(rpcFailure(peer, `Sending to thread ${threadId}`))),
        );
        return { threadId };
      }),
  });
});

export const layer = Layer.effect(PeerEnvironments, make);
