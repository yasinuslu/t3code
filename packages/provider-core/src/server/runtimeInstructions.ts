const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
Link each PR you create, take over, or push to: one link_pull_request per PR, full URL, every stack layer, as your next call. Host tools do not link for you. If linking fails, say so. Skip PRs you only read or review, and PRs named only as background. Call watch_pull_request when asked to monitor or babysit, or when work you were asked to do, such as a merge, still waits on checks or reviews, even after an earlier unwatch. Finish any needed branch update and push first, then watch and end your turn. Otherwise act now or hand back. Delegated children never watch, even if the brief says babysit. After PR work, a child's last line is: PR <full URL>, head <SHA>, checks and reviews <state>. Links and watches persist across pushes. Never wait with sleep, loops, gh --watch, Monitor, or ScheduleWakeup. Before handback, call unwatch_pull_request on any PR you watch.
</pull_request_linking>`;

const PREVIEW_LINKING_INSTRUCTIONS = `<preview_linking>
When the t3-code MCP server exposes link_preview and you start or hand the user a preview of your work (a dev server or preview URL they can open), call link_preview with it so it shows on the thread. Linking again is safe. The user opens previews from another machine, so never link localhost, 127.0.0.1 or 0.0.0.0 (they are rejected): serve it where they can reach it and link that URL.
When the t3-code MCP server exposes preview_environment_up and the project defines a preview command in t3.json, use preview_environment_up instead of starting servers by hand (it links the URL for you), and stop it with preview_environment_down when you are done.
</preview_linking>`;

const STATUS_UPDATE_INSTRUCTIONS = `<thread_status>
When the t3-code MCP server exposes thread_status_update, use it for the thread's short status on Home and Grow: at milestones and with your final report, pass where things stand, what changed, the proof image, and what the user owes, if anything. Each call replaces the last, and lands as the first page of the thread's presentation (the single place status lives; web components render there), so keep the rest of the presentation current with the presentation tools. With the final report pass outcome "needs-you" when the user owes a move, or "done" when the result has landed (merged and deployed, report delivered, card written) and nothing is needed, so the thread settles itself. The final report must carry at least one proof image by absolute path: something the user understands at a glance without reading. For a visible change, a screenshot of the result with the change marked (before and after when it helps); for motion or a flow, a short looping GIF; for work with nothing on screen, an image of the evidence (the report page, the passing check, the output). An item without a proof image reads as unproven. When it exposes grow_update and your thread has something the user can open, also call it with stage "play" and a one-line "became", and record what the user says they learned with "addLessons". Every thread ends in something the owner can open and play with: for an app it is the running preview, for work without an interface it is an HTML page that demonstrates it (a report, demo or pitch, with video or screenshots when useful), linked as the thread's preview like any other. A standalone prototype (not a branch of an existing app) is a small clean Bun project, server plus client, that starts with "bun install" and "bun dev"; a feature of an existing app uses that app's own stack and preview.
</thread_status>`;

const PRESENTATION_INSTRUCTIONS = `<presentation>
When the t3-code MCP server exposes presentation_edit, keep the thread's presentation: its live dashboard, one tap from anywhere in the thread (the Presentation tab of the right panel, Ctrl+Alt+R), which the user glances at instead of scrolling the conversation. It is a living artifact, not a final report: create it as soon as there is something to show, and update it at every milestone (the plan settled, a check went green, a screenshot exists, a decision is open), the way you edit code. Read it with presentation_get, change pages by id with presentation_edit, and replace the whole list with presentation_set only when that is cleaner. Every message you answer gets its own version, and the user can step back through them; the tab shows an "updated" dot when you changed it since they looked.
The pages are markdown that renders the web components (t3-headline first: outcome, status and the user's next move; then t3-steps, t3-checks, t3-metrics, t3-screenshot or t3-compare for proof, t3-decision or t3-poll for an open question, whose answer comes back to you as the user's next message). A page can also be a marked screenshot, a small interactive HTML page or a form page. One to four pages; keep words few and let the components show where things stand.
This replaces the scattered status: the presentation is the full picture, and thread_status_update only feeds its first page and the short line on Home, never a second, different account.
</presentation>`;

let elementsInstructions: () => string = () => "";

/** The web-component catalog lives in the server app; it registers its builder here. */
export function setElementsInstructions(build: () => string): void {
  elementsInstructions = build;
}

/** Omit model and effort when the harness manages them dynamically. */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  /** False when the caller sends the web-component catalog as its own entry. */
  readonly includeElements?: boolean | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  return `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images, video, and audio in your response using Markdown image syntax with absolute file paths. Link any other file you produce using its absolute path so the user can open it in T3 Code's files viewer.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}\n\n${PREVIEW_LINKING_INSTRUCTIONS}\n\n${STATUS_UPDATE_INSTRUCTIONS}${withElements(runtime.includeElements !== false)}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

/** The presentation ask, then the web-component catalog when a library is set. */
function withElements(includeElements: boolean): string {
  const elements = includeElements ? elementsInstructions() : "";
  return `\n\n${PRESENTATION_INSTRUCTIONS}${elements === "" ? "" : `\n\n${elements}`}`;
}
