import { setRuntimeInstructionExtras } from "@t3tools/provider-core/server/runtimeInstructions";

import { elementsInstructions } from "./elements/ElementsLibrary.ts";
import { forkFeatureOn } from "./forkFeatures.ts";

const PREVIEW_LINKING_INSTRUCTIONS = `<preview_linking>
When the t3-code MCP server exposes link_preview and you start or hand the user a preview of your work (a dev server or preview URL they can open), call link_preview with it so it shows on the thread. Linking again is safe. The user opens previews from another machine, so never link localhost, 127.0.0.1 or 0.0.0.0 (they are rejected): serve it where they can reach it and link that URL.
When the t3-code MCP server exposes preview_environment_up and the project defines a preview command in t3.json, use preview_environment_up instead of starting servers by hand (it links the URL for you), and stop it with preview_environment_down when you are done.
</preview_linking>`;

const PRESENTATION_INSTRUCTIONS = `<presentation>
When the t3-code MCP server exposes presentation_edit, keep the thread's presentation: the page the user keeps open in the right panel (Ctrl+Alt+R) to see what the thread did without reading the conversation. Create it as soon as there is something to show and update it at every milestone. Read it with presentation_get, change pages by id with presentation_edit, and use presentation_set only to replace every page. Each message you answer gets its own version the user can step back through.
Show, do not tell: t3-headline first (outcome, status, the user's next move), then proof the user understands at a glance, such as before/after screenshots (t3-compare), a screenshot with the change boxed (an image page with marks, or t3-screenshot), or a short looping GIF for motion or a flow. Pages can also be markdown with web components, a small HTML page or a form whose answer comes back as the user's next message. One to four pages, few words.
</presentation>`;

/** The web-component catalog, or nothing while web components are off. */
export function forkElementsInstructions(): string {
  return forkFeatureOn("webComponents") ? elementsInstructions() : "";
}

/** The fork's sections of every provider's runtime instructions, each behind its flag. */
function forkRuntimeInstructions(options: { readonly includeElements: boolean }): string {
  return [
    forkFeatureOn("previews") ? PREVIEW_LINKING_INSTRUCTIONS : "",
    forkFeatureOn("presentation") ? PRESENTATION_INSTRUCTIONS : "",
    options.includeElements ? forkElementsInstructions() : "",
  ]
    .filter((section) => section !== "")
    .join("\n\n");
}

setRuntimeInstructionExtras(forkRuntimeInstructions);
