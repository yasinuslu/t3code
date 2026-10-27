// @effect-diagnostics nodeBuiltinImport:off
// Read synchronously: the provider instructions that embed the catalog are built synchronously.
/**
 * ElementsLibrary - the web-component library assistant markdown may use (yasinuslu/t3-elements).
 *
 * The library is a folder whose `dist/` holds `t3-elements.js` (ESM that defines every custom
 * element) and `manifest.json` (every component's tag, description, props schema and example).
 * `T3CODE_ELEMENTS_LIBRARY` names the folder. It is read again whenever the manifest changes, so
 * a component an agent adds shows up without a restart.
 *
 * @module ElementsLibrary
 */
import type { ElementManifest, ElementsLibraryState } from "@t3tools/contracts";
import { validateElementProps } from "@t3tools/shared/elementProps";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

interface Loaded {
  readonly mtime: number;
  readonly state: Omit<ElementsLibraryState, "bundle">;
  readonly bundle: string;
}

let cache: { readonly dir: string; readonly loaded: Loaded } | null = null;

export function elementsLibraryDir(): string {
  const dir = (process.env.T3CODE_ELEMENTS_LIBRARY ?? "").trim();
  return dir.startsWith("~/") ? NodePath.join(NodeOS.homedir(), dir.slice(2)) : dir;
}

const EMPTY: Loaded = {
  mtime: 0,
  state: { configured: false, hash: "", version: "", components: [] },
  bundle: "",
};

function load(dir: string): Loaded {
  if (dir === "" || !NodePath.isAbsolute(dir)) return EMPTY;
  const manifestFile = NodePath.join(dir, "dist", "manifest.json");
  let mtime: number;
  try {
    mtime = NodeFS.statSync(manifestFile).mtimeMs;
  } catch {
    return {
      ...EMPTY,
      state: { ...EMPTY.state, configured: true, error: `No ${manifestFile}; run bun run build.` },
    };
  }
  if (cache !== null && cache.dir === dir && cache.loaded.mtime === mtime) return cache.loaded;
  try {
    const manifest = JSON.parse(NodeFS.readFileSync(manifestFile, "utf8")) as {
      version?: string;
      hash?: string;
      components?: ReadonlyArray<ElementManifest>;
    };
    const bundle = NodeFS.readFileSync(NodePath.join(dir, "dist", "t3-elements.js"), "utf8");
    const components = (manifest.components ?? []).filter(
      (component) =>
        typeof component?.tag === "string" &&
        /^t3-[a-z0-9-]+$/.test(component.tag) &&
        typeof component.description === "string",
    );
    const loaded: Loaded = {
      mtime,
      state: {
        configured: true,
        hash: manifest.hash ?? String(mtime),
        version: manifest.version ?? "",
        components,
      },
      bundle,
    };
    cache = { dir, loaded };
    return loaded;
  } catch (error) {
    return {
      ...EMPTY,
      state: {
        ...EMPTY.state,
        configured: true,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** The library for a client; the bundle only when the client lacks this version. */
export function readElementsLibrary(knownHash?: string): ElementsLibraryState {
  const loaded = load(elementsLibraryDir());
  return loaded.state.hash !== "" && loaded.state.hash !== knownHash
    ? { ...loaded.state, bundle: loaded.bundle }
    : loaded.state;
}

/** First sentence of a description, trimmed to about `max` characters. */
function firstSentence(text: string, max = 100): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const stop = flat.search(/[.!?](\s|$)/);
  const sentence = stop === -1 ? flat : flat.slice(0, stop);
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`;
}

/** Prop names in schema order, `*` on the required ones. */
function propNames(schema: Record<string, unknown>): string {
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  return Object.keys(properties)
    .map((name) => (required.has(name) ? `${name}*` : name))
    .join(", ");
}

/** One catalog line: tag, interactivity, a short summary and the prop names. */
export function compactLine(component: ElementManifest): string {
  const props = propNames(component.props);
  const text = component.body?.startsWith("text:")
    ? ` [text body = ${component.body.slice(5)}]`
    : "";
  return `<${component.tag}>${component.interactive ? " (interactive)" : ""} - ${firstSentence(component.description)}${text}${props === "" ? "" : `; props: ${props}`}`;
}

export type ElementDescription = {
  readonly tag: string;
  readonly description?: string;
  readonly body?: string;
  readonly props?: Record<string, unknown>;
  readonly example?: Record<string, unknown>;
  readonly interactive?: boolean;
  readonly error?: string;
};

function closeNames(tag: string, names: ReadonlyArray<string>): string[] {
  const needle = tag.replace(/^<|>$/g, "").replace(/^t3-/, "").toLowerCase();
  return names
    .filter((name) => {
      const bare = name.slice(3);
      return needle.length > 0 && (bare.includes(needle) || needle.includes(bare));
    })
    .slice(0, 5);
}

/**
 * The full manifest entries for the given tags, for the `elements_describe` MCP tool. An unknown
 * tag becomes an error entry naming close tags. No tags returns the compact catalog.
 */
export function describeElements(tags: ReadonlyArray<string>): {
  readonly catalog?: string;
  readonly components: ReadonlyArray<ElementDescription>;
} {
  const { state } = load(elementsLibraryDir());
  const components = state.components.filter((component) => component.hidden !== true);
  if (tags.length === 0) return { catalog: components.map(compactLine).join("\n"), components: [] };
  const byTag = new Map(components.map((component) => [component.tag, component]));
  return {
    components: tags.map((raw): ElementDescription => {
      const tag = raw.trim().replace(/^<|>$/g, "");
      const found = byTag.get(tag);
      if (found === undefined) {
        const close = closeNames(tag, [...byTag.keys()]);
        return {
          tag,
          error: `Unknown component ${tag}.${close.length > 0 ? ` Close names: ${close.join(", ")}.` : " Call with no tags for the catalog."}`,
        };
      }
      return {
        tag,
        description: found.description,
        body: found.body ?? "json",
        props: found.props,
        ...(found.example === undefined ? {} : { example: found.example }),
        interactive: found.interactive === true,
      };
    }),
  };
}

export type RenderComponentResult =
  | { readonly ok: true; readonly tag: string; readonly interactive: boolean }
  | { readonly ok: false; readonly message: string };

/**
 * Checks a `render_component` call against the library. A rejected call returns everything the
 * agent needs to retry in the same turn: what is wrong, the props schema and an example.
 */
export function renderComponent(
  rawTag: string,
  props: Readonly<Record<string, unknown>>,
): RenderComponentResult {
  const { state } = load(elementsLibraryDir());
  if (!state.configured || state.components.length === 0) {
    return { ok: false, message: "No component library is configured on this T3 server." };
  }
  const tag = rawTag.trim().replace(/^<|>$/g, "");
  const manifest = state.components.find((component) => component.tag === tag);
  if (manifest === undefined) {
    const close = closeNames(
      tag,
      state.components.filter((c) => c.hidden !== true).map((c) => c.tag),
    );
    return {
      ok: false,
      message: `Unknown component ${tag}.${close.length > 0 ? ` Close names: ${close.join(", ")}.` : " Call elements_describe with no tags for the catalog."}`,
    };
  }
  const result = validateElementProps(manifest, props);
  if (result.kind === "ok") {
    return { ok: true, tag, interactive: manifest.interactive === true };
  }
  const errors = result.kind === "invalid" ? result.errors : [];
  return {
    ok: false,
    message: [
      `${tag} was not shown: ${errors.join(" ")}`,
      `Call render_component again with corrected props. Props schema: ${JSON.stringify(manifest.props)}`,
      ...(manifest.example === undefined
        ? []
        : [`Example props: ${JSON.stringify(manifest.example)}`]),
    ].join("\n"),
  };
}

const CORE_EXAMPLE_TAGS = ["t3-headline", "t3-decision", "t3-checks"];

/** The manifest example of each core component, as a `render_component` call. */
function coreExamples(components: ReadonlyArray<ElementManifest>): string {
  return CORE_EXAMPLE_TAGS.flatMap((tag) => {
    const example = components.find((component) => component.tag === tag)?.example;
    return example === undefined
      ? []
      : [`render_component({"tag":"${tag}","props":${JSON.stringify(example)}})`];
  }).join("\n");
}

/**
 * The library as the agent reads it in its instructions. Empty when no library is set, so a
 * provider without one sees no change.
 */
export function elementsInstructions(): string {
  const dir = elementsLibraryDir();
  const { state } = load(dir);
  const components = state.components.filter((component) => component.hidden !== true);
  if (components.length === 0) return "";
  const catalog = components.map(compactLine).join("\n");
  return `<web_components>
T3 Code shows a library of web components in your replies. Use them: they are your richer language with the user, not decoration. Reach for one whenever it says something better than prose. Interactive components send the user's choice back to you as their next message, so you can talk with the user through them instead of asking them to type.

## When to reach for one
Make a component the default for these shapes, and keep plain prose for everything else. One or two per reply is normal; a reply made only of components is not.
- A final report or "done" message opens with t3-headline (the outcome, a status, the user's next move), then the details.
- CI or check state is t3-checks, never a bullet list of ticks.
- Files you changed are t3-file-tree. A PR is t3-pr, another thread is t3-thread, a running preview is t3-preview.
- Every question you need answered is t3-decision (2 to 4 options), t3-quick-replies (short answers), t3-poll (pick several), t3-form (several fields) or t3-rating. Never ask the user to "reply with a number" or type a letter.
- A list of options to choose from is t3-poll, or a selectable t3-datatable when each option has several columns.
- Before and after is t3-compare; a screenshot with the change boxed is t3-screenshot.
- Numbers that matter (three or more, or a delta) are t3-metrics; a series is t3-chart or t3-plot; compared options are t3-versus or t3-table.
- Progress and acceptance criteria are t3-steps or t3-checklist; a diff or snippet is t3-diff-card; a command and its output is t3-terminal.
Stay plain for a short conversational reply, a one-line answer, a clarification that needs no choice, and anything that is prose by nature. Never say the same thing in a component and again in prose. Components show only in chat replies and Grow document pages: thread_status_update text, commit messages, PR descriptions and files stay plain markdown.

## How to show one
Call the \`render_component\` tool with the tag and its props object. The component appears at that point in your reply, so a reply reads top to bottom like a notebook: write some text, call render_component, write more text, call it again. Props are checked when you call: a wrong shape comes back as an error that names what to fix, with the schema and an example, and nothing is shown until a call succeeds, so correct it and call again. After an interactive component, end your turn; the answer arrives as the user's next message. Images are absolute file paths or URLs.

The three you will use most:
${coreExamples(components)}

Only if you have no render_component tool, or inside a Grow document page (presentation_set and presentation_edit take markdown), write the component inline in the markdown instead: the tag on its own line with a blank line before and after it, and one JSON object of props as the only content between an opening and a closing tag, never attributes, never self-closing, no child tags, never in a code fence. A component marked [text body] below takes plain text there, and short scalar props as kebab-case attributes.

If no component fits and one would really help, add it to the library at ${dir} (read its README: one folder per component, element.ts plus manifest.json, then bun run build); it is live at once for new replies.

## Components
One line each: tag, summary, prop names (* = required). The names are not the full shape: before the first time you use a component in a thread, call the \`elements_describe\` tool with its tags for the props schema and an example (one cheap call), then render it like the example.
${catalog}
</web_components>`;
}

/** The library's components by tag, hidden ones included (the chat draws them too). */
export function elementComponents(): ReadonlyMap<string, ElementManifest> {
  const { state } = load(elementsLibraryDir());
  return new Map(state.components.map((component) => [component.tag, component]));
}
