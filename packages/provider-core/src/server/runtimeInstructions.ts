const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
Link each PR you create, take over, or push to: one link_pull_request per PR, full URL, every stack layer, as your next call. Host tools do not link for you. If linking fails, say so. Skip PRs you only read or review, and PRs named only as background. Call watch_pull_request when asked to monitor or babysit, or when work you were asked to do, such as a merge, still waits on checks or reviews, even after an earlier unwatch. Finish any needed branch update and push first, then watch and end your turn. Otherwise act now or hand back. Delegated children never watch, even if the brief says babysit. After PR work, a child's last line is: PR <full URL>, head <SHA>, checks and reviews <state>. Links and watches persist across pushes. Never wait with sleep, loops, gh --watch, Monitor, or ScheduleWakeup. Before handback, call unwatch_pull_request on any PR you watch.
</pull_request_linking>`;

const PREVIEW_LINKING_INSTRUCTIONS = `<preview_linking>
When the t3-code MCP server exposes link_preview and you start or hand the user a preview of your work (a dev server or preview URL they can open), call link_preview with it so it shows on the thread. Linking again is safe. The user opens previews from another machine, so never link localhost, 127.0.0.1 or 0.0.0.0 (they are rejected): serve it where they can reach it and link that URL.
When the t3-code MCP server exposes preview_environment_up and the project defines a preview command in t3.json, use preview_environment_up instead of starting servers by hand (it links the URL for you), and stop it with preview_environment_down when you are done.
</preview_linking>`;

const PRESENTATION_INSTRUCTIONS = `<presentation>
When the t3-code MCP server exposes presentation_edit, keep the thread's presentation: the page the user keeps open in the right panel (Ctrl+Alt+R) to see what the thread did without reading the conversation. Create it as soon as there is something to show and update it at every milestone. Read it with presentation_get, change pages by id with presentation_edit, and use presentation_set only to replace every page. Each message you answer gets its own version the user can step back through.
Show, do not tell: t3-headline first (outcome, status, the user's next move), then proof the user understands at a glance, such as before/after screenshots (t3-compare), a screenshot with the change boxed (an image page with marks, or t3-screenshot), or a short looping GIF for motion or a flow. Pages can also be markdown with web components, a small HTML page or a form whose answer comes back as the user's next message. One to four pages, few words.
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
  return `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images, video, and audio in your response using Markdown image syntax with absolute file paths. Link any other file you produce using its absolute path so the user can open it in T3 Code's files viewer.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}\n\n${PREVIEW_LINKING_INSTRUCTIONS}${withElements(runtime.includeElements !== false)}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

/** The presentation ask, then the web-component catalog when a library is set. */
function withElements(includeElements: boolean): string {
  const elements = includeElements ? elementsInstructions() : "";
  return `\n\n${PRESENTATION_INSTRUCTIONS}${elements === "" ? "" : `\n\n${elements}`}`;
}
