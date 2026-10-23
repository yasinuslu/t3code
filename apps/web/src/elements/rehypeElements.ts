/**
 * Runs after rehype-raw, before sanitizing: every `<t3-*>` element the model wrote becomes a
 * plain `span` carrying its tag, attributes and text as data, so the sanitizer passes it and the
 * markdown renderer hands it to ElementSlot. Nothing the model wrote runs as markup.
 */
/** The slice of hast this step reads; the tree comes from rehype-raw. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: unknown;
}

const ELEMENT_TAG = /^t3-[a-z0-9-]+$/;

function textOf(nodes: ReadonlyArray<HastNode>): string {
  let text = "";
  for (const node of nodes) {
    if (node.type === "text") text += node.value ?? "";
    else if (node.type === "element") {
      text += node.tagName === "br" ? "\n" : textOf(node.children ?? []);
      if (node.tagName === "p") text += "\n";
    }
  }
  return text;
}

function attributeText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value === true) return "";
  if (Array.isArray(value)) return value.join(" ");
  return null;
}

export function rehypeElements() {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      const children = node.children ?? [];
      children.forEach((child, index) => {
        if (child.type !== "element") return;
        if (!ELEMENT_TAG.test(child.tagName ?? "")) {
          visit(child);
          return;
        }
        const attributes: Record<string, string> = {};
        for (const [name, value] of Object.entries(child.properties ?? {})) {
          // Event handler attributes mean nothing to a component; drop them outright.
          if (/^on/i.test(name)) continue;
          const text = attributeText(value);
          if (text !== null) attributes[name] = text;
        }
        const replacement: HastNode = {
          type: "element",
          tagName: "span",
          properties: {
            dataT3Element: child.tagName,
            dataT3Attributes: JSON.stringify(attributes),
            dataT3Body: textOf(child.children ?? []),
          },
          children: [],
          ...(child.position ? { position: child.position } : {}),
        };
        children[index] = replacement;
      });
    };
    visit(tree);
  };
}

export const ELEMENT_SLOT_PROPERTIES = ["dataT3Element", "dataT3Attributes", "dataT3Body"];
