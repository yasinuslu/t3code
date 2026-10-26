/**
 * Turning a `<t3-*>` tag the model wrote into the props its component gets. Pure, so every way a
 * model can get it wrong (bad JSON, a missing prop, a half-streamed body) is decided here: the
 * web slot draws the outcome, and the server checks finished replies with the same rules so the
 * agent learns about a component the user sees as an error card.
 */
import type { ElementManifest } from "@t3tools/contracts";

export type ElementPropsResult =
  | { readonly kind: "ok"; readonly props: Record<string, unknown> }
  /** The body is not complete yet (still streaming). */
  | { readonly kind: "pending" }
  | { readonly kind: "invalid"; readonly errors: ReadonlyArray<string> };

const IGNORED_ATTRIBUTES = new Set(["class", "classname", "style", "id", "slot"]);

const camelCase = (name: string) =>
  name.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());

type PropSchema = {
  readonly type?: unknown;
  readonly enum?: unknown;
  readonly properties?: unknown;
  readonly required?: unknown;
  readonly items?: unknown;
};

const asSchema = (value: unknown): PropSchema | undefined =>
  typeof value === "object" && value !== null ? (value as PropSchema) : undefined;

function schemaProps(manifest: ElementManifest): Record<string, PropSchema> {
  const properties = manifest.props.properties;
  return typeof properties === "object" && properties !== null
    ? (properties as Record<string, PropSchema>)
    : {};
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value === "number"
    ? Number.isInteger(value)
      ? "integer"
      : "number"
    : typeof value;
}

function matches(type: unknown, value: unknown): boolean {
  if (typeof type !== "string") return true;
  const actual = typeOf(value);
  if (type === "number") return actual === "number" || actual === "integer";
  return actual === type;
}

/**
 * Errors for a value nested in a prop (an array item, an object field). Components fall back to
 * a placeholder for a missing or misnamed field, so without this a `label` written for `title`
 * draws a blank "Step" and nobody learns why.
 */
function nestedErrors(path: string, schema: PropSchema, value: unknown): string[] {
  if (value === undefined) return [];
  if (!matches(schema.type, value)) {
    return [`"${path}" should be ${String(schema.type)}, got ${typeOf(value)}.`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return [`"${path}" should be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}.`];
  }
  if (Array.isArray(value)) {
    const items = asSchema(schema.items);
    return items ? value.flatMap((item, i) => nestedErrors(`${path}[${i}]`, items, item)) : [];
  }
  const properties = asSchema(schema.properties) as Record<string, unknown> | undefined;
  if (typeof value !== "object" || value === null || !properties) return [];
  const record = value as Record<string, unknown>;
  const known = Object.keys(properties);
  const errors: string[] = [];
  for (const name of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
    if (record[name] === undefined) errors.push(`Missing "${path}.${name}".`);
  }
  for (const [name, field] of Object.entries(record)) {
    const fieldSchema = asSchema(properties[name]);
    if (fieldSchema) errors.push(...nestedErrors(`${path}.${name}`, fieldSchema, field));
    else errors.push(`Unknown "${path}.${name}"; the fields are ${known.join(", ")}.`);
  }
  return errors;
}

/** An attribute's text as the prop type its schema names. */
function attributeValue(raw: string, type: unknown): unknown {
  switch (type) {
    case "number":
    case "integer": {
      const number = Number(raw);
      return Number.isNaN(number) ? raw : number;
    }
    case "boolean":
      return raw === "" || raw === "true" || raw === type;
    case "array":
    case "object":
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    default:
      return raw;
  }
}

export function elementProps(input: {
  readonly manifest: ElementManifest;
  readonly attributes: Readonly<Record<string, string>>;
  readonly body: string;
  /** The message is still streaming: an unparseable body is unfinished, not wrong. */
  readonly streaming: boolean;
}): ElementPropsResult {
  const { manifest } = input;
  const schema = schemaProps(manifest);
  const props: Record<string, unknown> = {};
  const errors: string[] = [];
  const body = input.body.trim();
  const bodyKind = manifest.body ?? "json";

  if (bodyKind === "json" && body !== "") {
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        errors.push("The body must be one JSON object of props.");
      } else {
        Object.assign(props, parsed);
      }
    } catch (error) {
      if (input.streaming) return { kind: "pending" };
      errors.push(`The body is not valid JSON: ${error instanceof Error ? error.message : error}`);
    }
  } else if (bodyKind.startsWith("text:") && body !== "") {
    props[bodyKind.slice("text:".length)] = body;
  }

  for (const [rawName, raw] of Object.entries(input.attributes)) {
    if (IGNORED_ATTRIBUTES.has(rawName.toLowerCase())) continue;
    const name = camelCase(rawName);
    props[name] = attributeValue(raw, schema[name]?.type);
  }

  const required = Array.isArray(manifest.props.required)
    ? (manifest.props.required as string[])
    : [];
  for (const name of required) {
    if (props[name] === undefined) {
      if (input.streaming) return { kind: "pending" };
      errors.push(`Missing "${name}".`);
    }
  }
  for (const [name, value] of Object.entries(props)) {
    const propSchema = asSchema(schema[name]);
    if (propSchema) errors.push(...nestedErrors(name, propSchema, value));
  }
  return errors.length > 0 ? { kind: "invalid", errors } : { kind: "ok", props };
}

/** One `<t3-*>` block as written in a finished reply. */
export interface ElementBlock {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly body: string;
  /** The block exactly as written, for quoting it back. */
  readonly source: string;
  /** Set when the block itself is malformed, before its props are looked at. */
  readonly error?: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATTRIBUTE = /([^\s"'=<>/`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const OPENING_TAG =
  /^ {0,3}<(t3-[a-z0-9-]+)((?:\s+[^\s"'=<>/`]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/i;
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

const decodeEntities = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, name: string) => ENTITIES[name] ?? "");

function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of text.matchAll(ATTRIBUTE)) {
    const name = match[1]!.toLowerCase();
    if (name.startsWith("on")) continue;
    attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

/**
 * Every `<t3-*>` block that starts a line outside code fences, the way the chat's markdown
 * renders them. A tag mentioned mid-sentence or in a code sample is left alone.
 */
export function elementBlocks(markdown: string): ReadonlyArray<ElementBlock> {
  const lines = markdown.split("\n");
  const blocks: ElementBlock[] = [];
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === null) fence = marker;
      // A closing fence carries no info string.
      else if (
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.slice(fenceMatch[0].length).trim() === ""
      )
        fence = null;
      continue;
    }
    if (fence !== null) continue;
    const open = OPENING_TAG.exec(line);
    if (!open) continue;
    const tag = open[1]!.toLowerCase();
    const attributes = parseAttributes(open[2] ?? "");
    if (open[3] === "/") {
      blocks.push({
        tag,
        attributes,
        body: "",
        source: line.trim(),
        error: `<${tag}/> is self-closing; write an opening and a closing tag with the body between them.`,
      });
      continue;
    }
    // The body runs to the first closing tag, on this line or a later one.
    const closing = new RegExp(`</${tag}\\s*>`, "i");
    let rest = line.slice(open.index + open[0].length);
    const bodyLines: string[] = [];
    let end = index;
    let closed = false;
    while (true) {
      const close = closing.exec(rest);
      if (close) {
        bodyLines.push(rest.slice(0, close.index));
        closed = true;
        break;
      }
      bodyLines.push(rest);
      end += 1;
      if (end >= lines.length) break;
      rest = lines[end]!;
    }
    const source = lines.slice(index, Math.min(end, lines.length - 1) + 1).join("\n");
    if (!closed) {
      blocks.push({
        tag,
        attributes,
        body: bodyLines.join("\n"),
        source: source.trim(),
        error: `<${tag}> has no closing </${tag}>.`,
      });
      return blocks;
    }
    blocks.push({
      tag,
      attributes,
      body: decodeEntities(bodyLines.join("\n")),
      source: source.trim(),
    });
    index = end;
  }
  return blocks;
}

/** A component in a finished reply that renders as an error card instead of itself. */
export interface ElementProblem {
  readonly tag: string;
  readonly errors: ReadonlyArray<string>;
  readonly source: string;
}

/** The components in `markdown` that would not draw with this library. */
export function elementProblems(
  markdown: string,
  components: ReadonlyMap<string, ElementManifest>,
): ReadonlyArray<ElementProblem> {
  if (components.size === 0 || !markdown.includes("<t3-")) return [];
  return elementBlocks(markdown).flatMap((block): ElementProblem[] => {
    if (block.error !== undefined) {
      return [{ tag: block.tag, errors: [block.error], source: block.source }];
    }
    const manifest = components.get(block.tag);
    if (manifest === undefined) {
      return [
        { tag: block.tag, errors: [`Unknown component <${block.tag}>.`], source: block.source },
      ];
    }
    const result = elementProps({
      manifest,
      attributes: block.attributes,
      body: block.body,
      streaming: false,
    });
    return result.kind === "invalid"
      ? [{ tag: block.tag, errors: result.errors, source: block.source }]
      : [];
  });
}
