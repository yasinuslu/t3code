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

/** One compact line per prop: name, type, whether required, and its description. */
function propLines(schema: Record<string, unknown>): string[] {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  return Object.entries(properties).map(([name, prop]) => {
    const type = typeof prop.type === "string" ? prop.type : "any";
    const choices = Array.isArray(prop.enum) ? ` (${(prop.enum as unknown[]).join("|")})` : "";
    const description = typeof prop.description === "string" ? `: ${prop.description}` : "";
    return `  - ${name}${required.has(name) ? "" : "?"} ${type}${choices}${description}`;
  });
}

function usage(component: ElementManifest): string {
  const body = component.body ?? "json";
  if (body.startsWith("text:")) {
    return `<${component.tag} attr="...">${body.slice(5)} text</${component.tag}>`;
  }
  return `<${component.tag}>\n{"...": "..."}\n</${component.tag}>`;
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
  const catalog = components
    .map((component) =>
      [
        `### <${component.tag}>${component.interactive ? " (interactive)" : ""}`,
        component.description,
        `write: ${usage(component).replaceAll("\n", " ")}`,
        ...propLines(component.props),
        ...(component.example ? [`example: ${JSON.stringify(component.example)}`] : []),
      ].join("\n"),
    )
    .join("\n\n");
  return `<web_components>
T3 Code renders a library of web components inline in your replies. Use them: they are your richer language with the user, not decoration. Reach for one whenever it says something better than prose: a decision you need from the user, a checklist, metrics, a chart, a diff, a screenshot with boxes on what changed, a quick set of replies the user can tap, a small form. Interactive components send the user's choice back to you as their next message, so you can talk with the user through them instead of asking them to type.

How to write one: put the tag on its own line with a blank line before and after it, and no blank lines inside it. Components with a JSON body take one JSON object of props as their only content; components with a text body take plain text, and short scalar props as attributes (kebab-case). Images are absolute file paths or URLs. Prose around components stays normal markdown. Never wrap a component in a code fence unless you want to show its source.

Example:

<t3-decision>
{"question":"Which layout should the card use?","options":[{"label":"Stacked","answer":"Use the stacked layout.","recommended":true},{"label":"Side by side","answer":"Use the side-by-side layout."}]}
</t3-decision>

If no component fits and one would really help, add it to the library at ${dir} (read its README: one folder per component, element.ts plus manifest.json, then bun run build); it is live at once for new replies.

## Components
${catalog}
</web_components>`;
}
