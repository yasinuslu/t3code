// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalFetch:off globalConsole:off globalConsoleInEffect:off preferSchemaOverJson:off - Host-side dev fixture that talks to a running dev server.
/**
 * Seeds a DEV instance with believable Grow demo data: three fictional
 * projects and twelve idea threads spread over every stage, each with a
 * "became" line, lessons, a playable (served by prototypes/idea-board/serve.ts
 * under /demos/<slug>) and, on some, a status report and pull request.
 *
 * It uses the server's real commands only (project mutation over HTTP,
 * orchestration.dispatchCommand and grow.update over the WebSocket RPC), so no
 * agent runs. State lives in this worktree's `.t3`; it never touches
 * ~/.t3/userdata.
 *
 *   node apps/server/scripts/grow-seed-demo.ts             seed (re-runnable)
 *   node apps/server/scripts/grow-seed-demo.ts --reset     delete what it created
 *   node apps/server/scripts/grow-seed-demo.ts --backdate  spread ages (server must be STOPPED)
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import {
  CommandId,
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WsRpcGroup,
  type GrowStage,
} from "@t3tools/contracts";

const { values } = NodeUtil.parseArgs({
  options: {
    reset: { type: "boolean", default: false },
    backdate: { type: "boolean", default: false },
    origin: { type: "string" },
    "base-dir": { type: "string" },
  },
});

const root = NodePath.resolve(import.meta.dirname, "../../..");
const baseDir = NodePath.resolve(values["base-dir"] ?? NodePath.join(root, ".t3"));
if (baseDir === NodePath.join(process.env.HOME ?? "", ".t3")) {
  throw new Error("Refusing to seed the live ~/.t3 install.");
}
const PUBLIC_BASE = "https://t3code-proto-idea-board.pv.nepjua.org";
const demo = (slug: string) => `${PUBLIC_BASE}/demos/${slug}`;

const stable = (name: string) => {
  const hex = NodeCrypto.createHash("sha1").update(`grow-seed-demo:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

interface Idea {
  readonly slug: string;
  readonly project: string;
  readonly title: string;
  readonly stage?: GrowStage;
  readonly became?: string;
  readonly lessons?: ReadonlyArray<string>;
  readonly decision?: "adopt" | "pivot" | "shelve";
  readonly parent?: string;
  readonly playable?: { readonly slug: string; readonly label: string };
  readonly pullRequest?: {
    readonly number: number;
    readonly state: "open" | "merged";
    readonly title: string;
  };
  readonly report?: string;
  /** How long ago the thread was last touched, for --backdate. */
  readonly minutesAgo: number;
}

const PROJECTS = [
  { slug: "ledgerly", title: "Ledgerly" },
  { slug: "pacer", title: "Pacer API" },
  { slug: "shiplog", title: "shiplog" },
] as const;

const IDEAS: ReadonlyArray<Idea> = [
  {
    slug: "ledgerly-recurring-proration",
    project: "ledgerly",
    title: "Recurring invoices with proration on mid-cycle plan change",
    stage: "done",
    decision: "adopt",
    became: "Shipped: plan changes now split the cycle to the day and add a credit line.",
    lessons: [
      "Proration to the day confused nobody; proration to the hour made two customers email us.",
      "Credit lines must show the math inline or support gets the question anyway.",
      "Annual plans need their own rounding rule, cents drift over 12 months.",
    ],
    pullRequest: {
      number: 418,
      state: "merged",
      title: "Prorate recurring invoices on plan change",
    },
    report:
      "Plan changes mid-cycle now produce a prorated credit and a new line item.\n\nWhat changed\n- Proration is computed per day, banker's rounding on the total.\n- The invoice PDF shows the credit math under the line.\n\nNeeds you\n- Nothing, it has been live for two weeks.",
    minutesAgo: 60 * 24 * 9,
  },
  {
    slug: "ledgerly-late-nudges",
    project: "ledgerly",
    title: "Late-payment nudges: escalating reminder emails",
    stage: "building",
    decision: "adopt",
    became: "Four-step reminder ladder, friendly or firm tone per client, behind a flag.",
    lessons: [
      "Firm tone on day 3 lost us a client; friendly until day 10 collects just as fast.",
      "Skip the first nudge for clients with a clean history, they hate it most.",
    ],
    playable: { slug: "ledgerly-nudges", label: "Nudge timeline" },
    pullRequest: { number: 431, state: "open", title: "Late-payment nudges behind a flag" },
    report:
      "Nudges are wired into the invoice scheduler and tested against a frozen clock.\n\nWhat changed\n- Reminder ladder at day 3, 10, 21 and 35.\n- Tone is a per-client setting.\n\nNeeds you\n- Review the copy of the final notice before it goes out.",
    minutesAgo: 60 * 5,
  },
  {
    slug: "ledgerly-bank-transfer",
    project: "ledgerly",
    title: "Client portal: pay by bank transfer with auto-reconcile",
    stage: "regroup",
    became: "Portal tab with IBAN and reference, matched against the bank feed within minutes.",
    lessons: [
      "The reference field is what makes matching work; clients who edit it break it.",
      "People want a visible 'matched' moment, not just an email later.",
      "Partial payments are the real problem, the mock does not cover them yet.",
    ],
    playable: { slug: "ledgerly-bank-transfer", label: "Portal mock" },
    minutesAgo: 60 * 26,
  },
  {
    slug: "ledgerly-fee-passthrough",
    project: "ledgerly",
    title: "Stripe-fee pass-through toggle per invoice",
    became: "A switch that grosses the total up so the payout equals the net amount.",
    lessons: ["Grossing up looks greedy unless the fee is its own labelled line."],
    playable: { slug: "ledgerly-fee-passthrough", label: "Fee calculator" },
    minutesAgo: 25,
  },
  {
    slug: "ledgerly-receipt-ocr",
    project: "ledgerly",
    title: "Receipt OCR: drag a PDF, get line items",
    stage: "shelved",
    decision: "shelve",
    became: "Parked: accuracy too low on photographed receipts.",
    lessons: [
      "Clean PDFs hit 94%, phone photos 61%. Nobody trusts a tool that is right two thirds of the time.",
      "Users wanted expense capture, not receipts: they forward emails.",
    ],
    minutesAgo: 60 * 24 * 6,
  },
  {
    slug: "ledgerly-email-expenses",
    project: "ledgerly",
    title: "Expense capture by forwarding the email",
    became: "Pivot from OCR: forward a receipt email to a per-account address.",
    lessons: ["Most vendors already send a structured email, parsing it beats reading a photo."],
    parent: "ledgerly-receipt-ocr",
    minutesAgo: 60 * 3,
  },
  {
    slug: "pacer-wearable-dedupe",
    project: "pacer",
    title: "Wearable sync: dedupe overlapping Garmin and Apple workouts",
    became: "A fuzzy start-time key drops duplicates from 6.8% to 0.4%.",
    lessons: [
      "The 90 second window swallowed three real interval sessions, needs a tighter one for intervals.",
    ],
    playable: { slug: "pacer-wearable-dedupe-report", label: "Dedupe report" },
    report:
      "Fuzzy dedupe key measured on 41,200 synced workouts over 8 weeks.\n\nWhat changed\n- Duplicates fell from 6.8% to 0.4%.\n- Three real interval workouts were swallowed, window becomes 45 s for intervals.\n\nNeeds you\n- Decide whether 0.4% is good enough to ship.",
    minutesAgo: 60 * 2,
  },
  {
    slug: "pacer-weekly-summary",
    project: "pacer",
    title: "Weekly check-in summary generated from logs",
    stage: "idea",
    minutesAgo: 14,
  },
  {
    slug: "pacer-friend-challenges",
    project: "pacer",
    title: "Social challenges between friends",
    stage: "exploring",
    became: "Reading how Strava clubs and Duolingo leagues handle quitting.",
    lessons: ["Streak shame works short term, in the interviews people muted it by week two."],
    minutesAgo: 60 * 30,
  },
  {
    slug: "pacer-api-tiers",
    project: "pacer",
    title: "Public API tiers and pricing for coaches",
    stage: "regroup",
    became: "Free, Coach and Studio tiers with per-key rate limits.",
    lessons: [
      "Coaches compared us to a spreadsheet, not to other APIs, so price anchors at the CSV export.",
      "Nobody asked for the Studio audit log, it is there for the gym chains.",
    ],
    playable: { slug: "pacer-api-tiers-pitch", label: "Pitch" },
    minutesAgo: 60 * 8,
  },
  {
    slug: "shiplog-release-notes",
    project: "shiplog",
    title: "Monorepo-aware changelog grouping",
    stage: "exploring",
    became: "Grouping merged PRs by package using CODEOWNERS paths.",
    lessons: ["Conventional-commit scopes lie, file paths do not."],
    minutesAgo: 60 * 52,
  },
  {
    slug: "shiplog-doctor",
    project: "shiplog",
    title: "shiplog doctor: preflight checks before a release",
    became: "One command that checks git, remotes, lockfile and release config.",
    lessons: ["The lockfile drift check found a real bug on the first repo we ran it on."],
    playable: { slug: "shiplog-doctor-recording", label: "Recording" },
    minutesAgo: 40,
  },
];

const dirOf = (slug: string) => NodePath.join(baseDir, "demo-projects", slug);
const projectIdOf = (slug: string) => ProjectId.make(stable(`project:${slug}`));
const threadIdOf = (slug: string) => ThreadId.make(stable(`thread:${slug}`));
const commandId = (name: string) => CommandId.make(stable(`command:${name}`));

const serverOrigin = () => {
  if (values.origin) return values.origin;
  const runtime = JSON.parse(
    NodeFS.readFileSync(NodePath.join(baseDir, "userdata", "server-runtime.json"), "utf8"),
  );
  return String(runtime.origin);
};

const alive = async (origin: string) =>
  fetch(`${origin}/api/auth/websocket-ticket`, { method: "POST" }).then(
    () => true,
    () => false,
  );

if (values.backdate) {
  // server-runtime.json exists only while a server runs.
  const running = NodeFS.existsSync(NodePath.join(baseDir, "userdata", "server-runtime.json"));
  if (running && (await alive(serverOrigin()).catch(() => false))) {
    throw new Error("--backdate edits the database directly: stop the dev server first.");
  }
  const db = new NodeSqlite.DatabaseSync(NodePath.join(baseDir, "userdata", "statev2.sqlite"));
  const now = Date.now();
  for (const idea of IDEAS) {
    const at = new Date(now - idea.minutesAgo * 60_000).toISOString();
    const created = new Date(now - (idea.minutesAgo + 30) * 60_000).toISOString();
    const id = threadIdOf(idea.slug);
    const row = db
      .prepare("select payload_json from orchestration_v2_projection_threads where thread_id = ?")
      .get(id) as { payload_json: string } | undefined;
    if (!row) continue;
    const payload = JSON.parse(row.payload_json);
    payload.createdAt = created;
    payload.updatedAt = at;
    payload.lastVisitedAt = at;
    if (payload.statusUpdatedAt) payload.statusUpdatedAt = at;
    db.prepare(
      "update orchestration_v2_projection_threads set created_at = ?, updated_at = ?, payload_json = ? where thread_id = ?",
    ).run(created, at, JSON.stringify(payload), id);
    console.log(`backdated ${idea.slug} to ${idea.minutesAgo} min ago`);
  }
  db.close();
  process.exit(0);
}

const origin = serverOrigin();
const issued = JSON.parse(
  NodeChildProcess.execFileSync(
    "node",
    [
      NodePath.join(root, "apps/server/src/bin.ts"),
      "auth",
      "session",
      "issue",
      "--base-dir",
      baseDir,
      "--ttl",
      "15m",
      "--label",
      "grow-seed-demo",
      "--json",
    ],
    { encoding: "utf8", cwd: root },
  ),
) as { token: string };
const headers = {
  Authorization: `Bearer ${issued.token}`,
  "Content-Type": "application/json",
  [ORCHESTRATION_PROTOCOL_HEADER]: String(ORCHESTRATION_PROTOCOL_VERSION),
};

const mutateProject = async (body: Record<string, unknown>) => {
  const response = await fetch(`${origin}/api/projects/mutate`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok)
    console.log(
      `  project ${String(body.type)}: ${response.status} ${(await response.text()).slice(0, 160)}`,
    );
};

const ticketResponse = await fetch(`${origin}/api/auth/websocket-ticket`, {
  method: "POST",
  headers,
});
if (!ticketResponse.ok)
  throw new Error(`WebSocket authentication failed: ${ticketResponse.status}`);
const { ticket } = Schema.decodeUnknownSync(Schema.Struct({ ticket: Schema.String }))(
  await ticketResponse.json(),
);
const socket = Socket.layerWebSocket(
  `${origin.replace("http:", "ws:")}/ws?orchestrationProtocol=${ORCHESTRATION_PROTOCOL_VERSION}&wsTicket=${encodeURIComponent(ticket)}`,
).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal));
const protocol = RpcClient.layerProtocolSocket().pipe(
  Layer.provide(socket),
  Layer.provide(RpcSerialization.layerJson),
);

const nowIso = () => new Date().toISOString();

const program = Effect.gen(function* () {
  const client = yield* RpcClient.make(WsRpcGroup);
  // Failures are logged and skipped, so a re-run over existing data stays quiet.
  const dispatch = (name: string, command: Record<string, unknown>) =>
    client["orchestration.dispatchCommand"]({
      commandId: commandId(name),
      ...command,
    } as never).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => console.log(`  ${name}: skipped (${String(cause).slice(0, 120)})`)),
      ),
    );

  if (values.reset) {
    for (const idea of IDEAS) {
      yield* dispatch(`reset:${idea.slug}`, {
        type: "thread.delete",
        threadId: threadIdOf(idea.slug),
      });
    }
    yield* Effect.promise(async () => {
      for (const project of PROJECTS) {
        await mutateProject({
          type: "project.delete",
          commandId: stable(`reset:project:${project.slug}`),
          projectId: projectIdOf(project.slug),
          force: true,
        });
        NodeFS.rmSync(dirOf(project.slug), { recursive: true, force: true });
      }
    });
    console.log("Reset done. Cards of deleted threads stay in grow.json but match no thread.");
    return;
  }

  yield* Effect.promise(async () => {
    for (const project of PROJECTS) {
      NodeFS.mkdirSync(dirOf(project.slug), { recursive: true });
      await mutateProject({
        type: "project.create",
        commandId: stable(`project:${project.slug}`),
        projectId: projectIdOf(project.slug),
        title: project.title,
        workspaceRoot: dirOf(project.slug),
        createWorkspaceRootIfMissing: true,
      });
      // A project that already exists keeps its old title on create, so set it.
      await mutateProject({
        type: "project.update",
        commandId: stable(`project-title:${project.slug}:${project.title}`),
        projectId: projectIdOf(project.slug),
        title: project.title,
      });
    }
  });

  for (const idea of IDEAS) {
    console.log(`- ${idea.slug}`);
    const threadId = threadIdOf(idea.slug);
    yield* dispatch(`create:${idea.slug}`, {
      type: "thread.create",
      createdBy: "user",
      creationSource: "web",
      threadId,
      projectId: projectIdOf(idea.project),
      title: idea.title,
      modelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-5-5",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
    });
    if (idea.playable) {
      yield* dispatch(`preview:${idea.slug}`, {
        type: "thread.preview-link.link",
        threadId,
        url: demo(idea.playable.slug),
        label: idea.playable.label,
        source: "agent",
      });
    }
    if (idea.report) {
      yield* dispatch(`report:${idea.slug}`, {
        type: "thread.status-report.set",
        threadId,
        text: idea.report,
      });
    }
    if (idea.pullRequest) {
      const key = {
        host: "github.com",
        repository: `demo-org/${idea.project}`,
        number: idea.pullRequest.number,
      };
      yield* dispatch(`pr-link:${idea.slug}`, {
        type: "thread.pull-request.link",
        threadId,
        ...key,
        url: `https://github.com/demo-org/${idea.project}/pull/${idea.pullRequest.number}`,
        source: "manual",
      });
      yield* dispatch(`pr-sync:${idea.slug}`, {
        type: "thread.pull-request-link.sync",
        threadId,
        ...key,
        snapshot: {
          state: idea.pullRequest.state,
          title: idea.pullRequest.title,
          headBranch: `feature/${idea.slug}`,
          baseBranch: "main",
          isDraft: false,
          updatedAt: nowIso(),
          syncedAt: nowIso(),
          mergedAt: idea.pullRequest.state === "merged" ? nowIso() : null,
          closedAt: idea.pullRequest.state === "merged" ? nowIso() : null,
        },
        stack: null,
      });
    }
    yield* client["grow.update"]({
      threadId,
      ...(idea.stage ? { stage: idea.stage } : {}),
      ...(idea.became ? { became: idea.became } : {}),
      lessons: idea.lessons ?? [],
      ...(idea.decision ? { decision: idea.decision } : {}),
      ...(idea.parent ? { parentThreadId: threadIdOf(idea.parent) } : {}),
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => console.log(`  grow: ${String(cause).slice(0, 160)}`)),
      ),
    );
  }

  // Read back: count per project and stage.
  const item = yield* client["orchestration.subscribeShell"]({}).pipe(
    Stream.filter((entry) => entry.kind === "snapshot"),
    Stream.take(1),
    Stream.runCollect,
  );
  const snapshot = (
    Array.from(item)[0] as {
      snapshot: { threads: ReadonlyArray<any>; projects: ReadonlyArray<any> };
    }
  ).snapshot;
  const grow = yield* client["grow.state"]({});
  const cardOf = new Map(grow.cards.map((card) => [card.threadId as string, card]));
  const table = new Map<string, Map<string, number>>();
  for (const idea of IDEAS) {
    const thread = snapshot.threads.find((candidate) => candidate.id === threadIdOf(idea.slug));
    if (!thread) {
      console.log(`MISSING thread ${idea.slug}`);
      continue;
    }
    const stage =
      cardOf.get(thread.id)?.stage ??
      ((thread.previewLinks?.length ?? 0) > 0 ? "play" : "exploring");
    const row = table.get(idea.project) ?? new Map();
    row.set(stage, (row.get(stage) ?? 0) + 1);
    table.set(idea.project, row);
  }
  for (const [project, row] of table) {
    console.log(project, JSON.stringify(Object.fromEntries(row)));
  }
}).pipe(Effect.scoped, Effect.provide(protocol), Effect.timeout(120_000));

await Effect.runPromise(program);
process.exit(0);
