import type { AssetResource, EnvironmentId, GrowWidgetPoolState } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { growEnvironment } from "../../state/grow";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAssetUrls } from "../../assets/assetUrls";
import {
  attachmentRefs,
  type WidgetBlockInput,
  type WidgetFrameMessage,
  type WidgetFrameRender,
  type WidgetThreadFacts,
} from "../../widgetFrame/protocol";

/** Each environment's pool, fetched once and again when a page names a widget it lacks. */
const pools = new Map<string, { readonly at: number; readonly pool: GrowWidgetPoolState }>();
const poolListeners = new Set<() => void>();
const REFETCH_AFTER_MS = 10_000;

function subscribePools(listener: () => void) {
  poolListeners.add(listener);
  return () => {
    poolListeners.delete(listener);
  };
}

export function useWidgetPool(
  environmentId: EnvironmentId,
  wanted: ReadonlyArray<string>,
): GrowWidgetPoolState | null {
  const fetchPool = useAtomCommand(growEnvironment.widgetPool, { reportFailure: false });
  const pool = useSyncExternalStore(subscribePools, () => pools.get(environmentId)?.pool ?? null);
  const missing = wanted.some((name) => !pool?.widgets.some((widget) => widget.name === name));
  useEffect(() => {
    const cached = pools.get(environmentId);
    // A widget the smith just added is on disk but not in the copy here yet.
    if (cached !== undefined && (!missing || Date.now() - cached.at < REFETCH_AFTER_MS)) return;
    void fetchPool({ environmentId, input: {} }).then((result) => {
      if (result._tag !== "Success") return;
      pools.set(environmentId, { at: Date.now(), pool: result.value });
      for (const listener of poolListeners) listener();
    });
  }, [environmentId, fetchPool, missing]);
  return pool;
}

const readRootTheme = () => ({
  className: document.documentElement.className,
  style: document.documentElement.getAttribute("style") ?? "",
});

/** The app's theme as the frame should wear it. */
function useRootTheme() {
  const [theme, setTheme] = useState(readRootTheme);
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setTheme((current) => {
        const next = readRootTheme();
        return next.className === current.className && next.style === current.style
          ? current
          : next;
      }),
    );
    observer.observe(document.documentElement, { attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/**
 * A living page: the thread's blocks drawn by the workspace's pool widgets, in a sandboxed frame
 * that grows to its content. Decision widgets answer the thread through `onAnswer`.
 */
export function WidgetPage(props: {
  readonly environmentId: EnvironmentId;
  readonly blocks: ReadonlyArray<WidgetBlockInput>;
  readonly thread: WidgetThreadFacts;
  readonly readOnly: boolean;
  readonly onAnswer: (text: string) => void;
}) {
  const { blocks } = props;
  const names = useMemo(() => [...new Set(blocks.map((block) => block.widget))], [blocks]);
  const pool = useWidgetPool(props.environmentId, names);
  const refs = useMemo(() => attachmentRefs(blocks), [blocks]);
  const resources = useMemo(
    (): AssetResource[] => refs.map((attachmentId) => ({ _tag: "attachment", attachmentId })),
    [refs],
  );
  const urls = useAssetUrls(props.environmentId, resources);
  const theme = useRootTheme();
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(240);

  const render = useMemo((): WidgetFrameRender | null => {
    if (pool === null) return null;
    const modules: Record<string, string> = {};
    for (const widget of pool.widgets)
      if (names.includes(widget.name)) modules[widget.name] = widget.code;
    const images: Record<string, string> = {};
    refs.forEach((id, index) => {
      const url = urls[index];
      if (url) images[id] = new URL(url, window.location.href).href;
    });
    return {
      type: "t3-widgets-render",
      modules,
      blocks,
      images,
      thread: props.thread,
      theme,
      readOnly: props.readOnly,
    };
  }, [blocks, names, pool, props.readOnly, props.thread, refs, theme, urls]);

  const onAnswer = useEffectEvent((text: string) => props.onAnswer(text));
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (frame.current === null || event.source !== frame.current.contentWindow) return;
      const data = event.data as WidgetFrameMessage | null;
      switch (data?.type) {
        case "t3-widgets-ready":
          setReady(true);
          break;
        case "t3-widgets-height":
          if (typeof data.height === "number" && data.height > 0) setHeight(data.height);
          break;
        case "t3-artifact-answer":
          if (typeof data.text === "string") onAnswer(data.text.slice(0, 4000));
          break;
        case "t3-widgets-open":
          if (typeof data.url === "string" && /^(https?:|data:image\/)/.test(data.url)) {
            window.open(data.url, "_blank", "noopener,noreferrer");
          }
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (ready && render !== null) frame.current?.contentWindow?.postMessage(render, "*");
  }, [ready, render]);

  return (
    <iframe
      ref={frame}
      title="Living page"
      src="/widget-frame.html"
      // Scripts only: no same-origin, so a widget cannot reach the app, its storage or socket.
      sandbox="allow-scripts"
      className="block w-full border-0 bg-transparent"
      style={{ height }}
    />
  );
}
