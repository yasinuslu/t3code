/**
 * Turning a `<t3-*>` tag the model wrote into the props its component gets. Pure, so every way a
 * model can get it wrong (bad JSON, a missing prop, a half-streamed body) is decided here and the
 * slot only draws the outcome.
 */
import { normalizeComponentQuestion } from "@t3tools/client-runtime/user-message";
import type { ElementManifest } from "@t3tools/contracts";

export type ElementPropsResult =
  | { readonly kind: "ok"; readonly props: Record<string, unknown> }
  /** The body is not complete yet (still streaming). */
  | { readonly kind: "pending" }
  | { readonly kind: "invalid"; readonly errors: ReadonlyArray<string> };

const IGNORED_ATTRIBUTES = new Set(["class", "classname", "style", "id", "slot"]);

const camelCase = (name: string) =>
  name.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());

type PropSchema = { readonly type?: unknown };

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
    const type = schema[name]?.type;
    if (value !== undefined && !matches(type, value)) {
      errors.push(`"${name}" should be ${String(type)}, got ${typeOf(value)}.`);
    }
  }
  return errors.length > 0 ? { kind: "invalid", errors } : { kind: "ok", props };
}

/**
 * While a reply streams, a tag can arrive cut in half (`<t3-deci`); it would flash as text, so
 * it waits for the next chunk.
 */
export function trimPartialElementTag(text: string): string {
  return text.replace(/<\/?t3-[^>\n]*$/, "");
}

/** Readable text for a component: its body text, or the string values of its JSON props. */
export function elementPlainText(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const strings: string[] = [];
    const visit = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (typeof value === "object" && value !== null) Object.values(value).forEach(visit);
    };
    visit(JSON.parse(trimmed));
    return strings.join(" · ");
  } catch {
    return trimmed;
  }
}

/** The question an interactive component asks, whatever that component calls the prop. */
export function elementQuestion(props: Readonly<Record<string, unknown>>): string {
  for (const name of ["question", "prompt", "title"]) {
    const value = props[name];
    if (typeof value === "string" && value.trim() !== "") return normalizeComponentQuestion(value);
  }
  return "";
}
