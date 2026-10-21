/**
 * The widget frame: runs a living page's pool widgets in a sandbox without same-origin access,
 * so code a model wrote never touches the app, its cookies or its socket. Grow posts the page
 * (see protocol.ts); widgets reach back only through `t3/widget`.
 */
import "../index.css";

// oxlint-disable-next-line no-restricted-imports -- pool widgets pick any icon by its name
import * as Lucide from "lucide-react";
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import * as Recharts from "recharts";

import type { WidgetFrameMessage, WidgetFrameRender, WidgetThreadFacts } from "./protocol";
import { addWidgetClasses } from "./tailwind";
import * as Ui from "./ui";

interface WidgetRuntime {
  readonly image: (ref: string) => string;
  readonly answer: (text: string) => void;
  readonly open: (url: string) => void;
  readonly thread: WidgetThreadFacts;
}

const post = (message: WidgetFrameMessage) => window.parent.postMessage(message, "*");

const RuntimeContext = React.createContext<WidgetRuntime>({
  image: () => "",
  answer: () => undefined,
  open: () => undefined,
  thread: { title: "", status: "" },
});

const modules: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": JsxRuntime,
  "lucide-react": Lucide,
  recharts: Recharts,
  "t3/ui": Ui,
  "t3/widget": { useT3: () => React.useContext(RuntimeContext) },
};

function requireModule(name: string): unknown {
  if (name in modules) return modules[name];
  throw new Error(`"${name}" is not in the widget runtime.`);
}

/** Widgets by their compiled code, so a page sent again reuses the components it has. */
const loaded = new Map<string, React.ComponentType<Record<string, unknown>> | Error>();

function loadWidget(code: string): React.ComponentType<Record<string, unknown>> | Error {
  const known = loaded.get(code);
  if (known !== undefined) return known;
  let result: React.ComponentType<Record<string, unknown>> | Error;
  try {
    const module = { exports: {} as Record<string, unknown> };
    // Running pool widgets is this frame's whole job.
    new Function("module", "exports", "require", code)(module, module.exports, requireModule);
    const component = module.exports.default;
    result =
      typeof component === "function"
        ? (component as React.ComponentType<Record<string, unknown>>)
        : new Error("It has no default export.");
  } catch (error) {
    result = error instanceof Error ? error : new Error(String(error));
  }
  loaded.set(code, result);
  return result;
}

/** A neutral stand-in for `example:<word>` images in the gallery. */
function exampleImage(word: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="100%" height="100%" fill="#8882"/><text x="50%" y="50%" fill="#888" font-family="system-ui" font-size="48" text-anchor="middle" dominant-baseline="middle">${word.replace(/[^\w -]/g, "")}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

class BlockBoundary extends React.Component<
  { readonly name: string; readonly children: React.ReactNode },
  { readonly error: Error | null }
> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error === null) return this.props.children;
    return <BlockError name={this.props.name} error={this.state.error.message} />;
  }
}

function BlockError(props: { readonly name: string; readonly error: string }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-3 text-muted-foreground text-xs">
      <span className="font-medium text-foreground">{props.name}</span> could not draw:{" "}
      {props.error}
    </div>
  );
}

function Page(props: { readonly page: WidgetFrameRender }) {
  const { page } = props;
  const runtime = React.useMemo(
    (): WidgetRuntime => ({
      image: (ref) =>
        ref.startsWith("attachment:")
          ? (page.images[ref.slice("attachment:".length)] ?? "")
          : ref.startsWith("example:")
            ? exampleImage(ref.slice("example:".length))
            : "",
      answer: (text) => {
        if (!page.readOnly && text.trim().length > 0) post({ type: "t3-artifact-answer", text });
      },
      open: (url) => {
        if (/^https?:\/\//.test(url)) post({ type: "t3-widgets-open", url });
        else if (url.startsWith("data:image/")) post({ type: "t3-widgets-open", url });
      },
      thread: page.thread,
    }),
    [page],
  );
  return (
    <RuntimeContext.Provider value={runtime}>
      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:gap-4 sm:p-4">
        {page.blocks.map((block, index) => {
          const code = page.modules[block.widget];
          const Widget =
            code === undefined ? new Error("It is not in the pool.") : loadWidget(code);
          return (
            <div
              // Blocks have no ids; a page edit redraws the ones that moved, which is cheap.
              // oxlint-disable-next-line react/no-array-index-key
              key={`${index}:${block.widget}`}
              className={block.span === "half" ? "min-w-0" : "min-w-0 sm:col-span-2"}
            >
              {block.caption ? (
                <div className="mb-2 flex flex-col gap-0.5 px-1 pt-4">
                  <span className="font-medium font-mono text-sm">{block.caption.title}</span>
                  <span className="text-muted-foreground text-xs">{block.caption.detail}</span>
                </div>
              ) : null}
              {Widget instanceof Error ? (
                <BlockError name={block.widget} error={Widget.message} />
              ) : (
                <BlockBoundary name={block.widget}>
                  <Widget {...block.props} />
                </BlockBoundary>
              )}
            </div>
          );
        })}
      </div>
    </RuntimeContext.Provider>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const data = event.data as Partial<WidgetFrameRender> | null;
    if (data?.type !== "t3-widgets-render") return;
    const page = data as WidgetFrameRender;
    document.documentElement.className = page.theme.className;
    document.documentElement.setAttribute("style", page.theme.style);
    // Draw at once; the widgets' own classes land a moment later.
    root.render(<Page page={page} />);
    void addWidgetClasses(Object.values(page.modules));
  });
  // Grow's Alt keys keep working while focus is inside the page (see withGrowKeys).
  window.addEventListener(
    "keydown",
    (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      window.parent.postMessage(
        { type: "t3-grow-key", code: event.code, shift: event.shiftKey },
        "*",
      );
    },
    true,
  );
  new ResizeObserver(() =>
    post({
      type: "t3-widgets-height",
      height: Math.ceil(container.getBoundingClientRect().height),
    }),
  ).observe(container);
  post({ type: "t3-widgets-ready" });
}
