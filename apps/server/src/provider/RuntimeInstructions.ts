import { elementsInstructions } from "../elements/ElementsLibrary.ts";

const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
When the t3-code MCP server exposes link_pull_request, you must use it to register every pull request you create or work on for this thread. Call link_pull_request with the full PR URL immediately after creating a PR or starting work on an existing PR. For a stack, call it for every layer, not just the current branch or the top PR. This applies when creating or updating PRs through gh, gh stack, another CLI, or the host API: those operations do not register the PRs with this thread. Linking an already-linked PR is safe. Before finishing PR work, call list_thread_pull_requests and link any PR from your work that is missing. Do not link unrelated PRs mentioned only as background. If a linking call fails, report that failure instead of claiming the PR is linked. When asked to monitor, watch, or babysit a PR and watch_pull_request is available, call it and end your turn: T3 Code wakes you when checks finish, someone else comments, or the branch conflicts, so do not poll or run your own watcher.
</pull_request_linking>`;

const PREVIEW_LINKING_INSTRUCTIONS = `<preview_linking>
When the t3-code MCP server exposes link_preview and you start or hand the user a preview of your work (a dev server or preview URL they can open), call link_preview with it so it shows on the thread. Linking again is safe. The user opens previews from another machine, so never link localhost, 127.0.0.1 or 0.0.0.0 (they are rejected): serve it where they can reach it and link that URL.
When the t3-code MCP server exposes preview_environment_up and the project defines a preview command in t3.json, use preview_environment_up instead of starting servers by hand (it links the URL for you), and stop it with preview_environment_down when you are done.
</preview_linking>`;

const STATUS_UPDATE_INSTRUCTIONS = `<thread_status>
When the t3-code MCP server exposes thread_status_update, use it to keep the thread's status card current: at milestones and with your final report, pass where things stand, what changed, the proof image, and what the user owes, if anything. Each call replaces the last. The final report must carry at least one proof image by absolute path: something the user understands at a glance without reading. For a visible change, a screenshot of the result with the change marked (before and after when it helps); for motion or a flow, a short looping GIF; for work with nothing on screen, an image of the evidence (the report page, the passing check, the output). Without a presentation, Grow shows that image first, and an item without either reads as unproven. When it exposes grow_update and your thread has something the user can open, also call it with stage "play" and a one-line "became", and record what the user says they learned with "addLessons". Every thread ends in something the owner can open and play with: for an app it is the running preview, for work without an interface it is an HTML page that demonstrates it (a report, demo or pitch, with video or screenshots when useful), linked as the thread's preview like any other. A standalone prototype (not a branch of an existing app) is a small clean Bun project, server plus client, that starts with "bun install" and "bun dev"; a feature of an existing app uses that app's own stack and preview.
</thread_status>`;

const PRESENTATION_INSTRUCTIONS = `<presentation>
When the t3-code MCP server exposes presentation_edit, keep a presentation of your work: the idea in a form the user grasps at a glance, which Grow shows first, beside the conversation and the live preview. It is a living artifact, not a final report: create it early, as soon as there is an idea to show, and edit it as the work changes, the way you edit code. Read it with presentation_get, change pages by id with presentation_edit, and replace the whole list with presentation_set only when it is cleaner. Every message you answer gets its own version, and the user can step back through them. One to four pages: a screenshot of the result with marks boxing what changed, a short markdown page (the decision, a before and after table), a small self-contained interactive HTML page (a mock to click through, a chart), or a form page when you need the user to decide (a few questions; the answers come back as a message). Keep words few and let the pages show the idea.
</presentation>`;

/**
 * Shared runtime context; omit model and effort when the harness manages them dynamically.
 * `modelName` is the display name users see in the model picker; `model` is the slug.
 */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  return `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}\n\n${PREVIEW_LINKING_INSTRUCTIONS}\n\n${STATUS_UPDATE_INSTRUCTIONS}${withElements()}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

let presentationEnabled = false;

/**
 * Mirrors the `growPresentation` server setting (GrowPresentationSetting.ts keeps it current), so
 * the synchronous builders above can ask for a presentation only while Grow shows one.
 */
export function setPresentationInstructionsEnabled(enabled: boolean): void {
  presentationEnabled = enabled;
}

/** The presentation ask while it is switched on, then the web-component catalog when a library is set. */
function withElements(): string {
  const elements = elementsInstructions();
  return `${presentationEnabled ? `\n\n${PRESENTATION_INSTRUCTIONS}` : ""}${elements === "" ? "" : `\n\n${elements}`}`;
}
