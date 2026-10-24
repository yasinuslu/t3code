/**
 * Web-only helpers for `<t3-*>` tags; the props themselves are decided by the shared
 * `elementProps`, which the server also uses to check finished replies.
 */
import { normalizeComponentQuestion } from "@t3tools/client-runtime/user-message";

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
