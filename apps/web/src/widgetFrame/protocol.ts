/**
 * Messages between Grow and the widget frame (`widget-frame.html`), the sandboxed page that runs
 * a living page's widgets. The frame has an opaque origin, so both sides check `source` instead.
 */

/** Live facts about the thread a page is about; they change without a new page version. */
export interface WidgetThreadFacts {
  readonly title: string;
  readonly status: string;
  readonly pullRequest?: { readonly number: number; readonly url: string; readonly state: string };
  readonly previewUrl?: string;
}

export interface WidgetBlockInput {
  readonly widget: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly span?: "full" | "half" | undefined;
  /** The gallery's heading over a block: the widget's name and what it is for. */
  readonly caption?: { readonly title: string; readonly detail: string } | undefined;
}

/** Grow to frame: everything the page needs to draw, sent again whenever any of it changes. */
export interface WidgetFrameRender {
  readonly type: "t3-widgets-render";
  /** Compiled CommonJS by widget name; only the widgets the blocks use. */
  readonly modules: Readonly<Record<string, string>>;
  readonly blocks: ReadonlyArray<WidgetBlockInput>;
  /** URLs of `attachment:<id>` image refs, already signed and absolute. */
  readonly images: Readonly<Record<string, string>>;
  readonly thread: WidgetThreadFacts;
  /** The app's root class and inline style, so the frame wears the same theme. */
  readonly theme: { readonly className: string; readonly style: string };
  /** An earlier version: decision buttons show but send nothing. */
  readonly readOnly: boolean;
}

/** Frame to Grow. */
export type WidgetFrameMessage =
  | { readonly type: "t3-widgets-ready" }
  | { readonly type: "t3-widgets-height"; readonly height: number }
  | { readonly type: "t3-artifact-answer"; readonly text: string }
  | { readonly type: "t3-widgets-open"; readonly url: string };

/** Every `attachment:<id>` string anywhere in a page's props, for Grow to sign. */
export function attachmentRefs(blocks: ReadonlyArray<WidgetBlockInput>): ReadonlyArray<string> {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (/^attachment:[\w-]+$/.test(value)) found.add(value.slice("attachment:".length));
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (typeof value === "object" && value !== null) {
      for (const item of Object.values(value)) visit(item);
    }
  };
  for (const block of blocks) visit(block.props);
  return [...found];
}
