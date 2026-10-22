/**
 * The host side of the library's `t3-portal` capability: a full viewport overlay above everything
 * (sidebars, dialogs, toasts), mounted on document.body. An image request becomes a lightbox; an
 * element request mounts the same custom element again with `fullscreen` set. Pure UI: the slot
 * that received the event decides when it opens, and what a `t3-send` or `t3-open` from inside does.
 */
import { ChevronLeftIcon, ChevronRightIcon, MaximizeIcon, MinimizeIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "../lib/utils";
import { type PortalRequest, portalKeyAction, stepIndex, swipeDelta } from "./portalLogic";

export interface PortalHostProps {
  readonly request: PortalRequest;
  readonly onClose: () => void;
  /** A `t3-send` raised inside an element portal. */
  readonly onSend: (event: Event) => void;
  /** A `t3-open` raised inside an element portal. */
  readonly onOpen: (event: Event) => void;
}

/** The focused element, looking through shadow roots so a button inside a component counts. */
function deepActiveElement(): HTMLElement | null {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : null;
}

export function PortalHost(props: PortalHostProps) {
  const { request, onClose } = props;
  const root = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(request.kind === "image" ? request.index : 0);
  const [fit, setFit] = useState(true);
  const [trueFullscreen, setTrueFullscreen] = useState(false);
  const imageCount = request.kind === "image" ? request.images.length : 0;

  // Focus moves in, is trapped while open, and returns to the opener on close.
  useLayoutEffect(() => {
    const opener = deepActiveElement();
    const node = root.current;
    node?.focus();
    const onFocusIn = (event: FocusEvent) => {
      if (node && event.target instanceof Node && !node.contains(event.target)) node.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      if (document.fullscreenElement === node) void document.exitFullscreen().catch(() => {});
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Keys stay inside the overlay: only the handled ones act, and nothing reaches app shortcuts.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const action = portalKeyAction(event.key, imageCount);
      if (!action) return;
      event.preventDefault();
      if (action.type === "close") onClose();
      else {
        setIndex((i) => stepIndex(i, action.delta, imageCount));
        setFit(true);
      }
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [imageCount, onClose]);

  useEffect(() => {
    const onChange = () => setTrueFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleTrueFullscreen = () => {
    const node = root.current;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void node.requestFullscreen?.().catch(() => {});
  };

  const step = (delta: 1 | -1) => {
    setIndex((i) => stepIndex(i, delta, imageCount));
    setFit(true);
  };

  const fullscreenButton = (
    <OverlayButton
      label={trueFullscreen ? "Exit full screen" : "Use the whole screen"}
      onClick={toggleTrueFullscreen}
    >
      {trueFullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
    </OverlayButton>
  );
  const closeButton = (
    <OverlayButton label="Close" onClick={onClose}>
      <XIcon />
    </OverlayButton>
  );

  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={
        request.kind === "element" ? (request.title ?? "Full screen view") : "Image viewer"
      }
      tabIndex={-1}
      data-t3-portal={request.kind}
      className={cn(
        "t3-portal t3-element-host fixed inset-0 z-[200] flex flex-col outline-none",
        request.kind === "image" ? "bg-black text-white" : "bg-background text-foreground",
      )}
    >
      {request.kind === "image" ? (
        <ImageView
          request={request}
          index={index}
          fit={fit}
          onToggleFit={() => setFit((value) => !value)}
          onStep={step}
          onClose={onClose}
          actions={
            <>
              {fullscreenButton}
              {closeButton}
            </>
          }
        />
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b px-3 t3-portal-top pb-2">
            <div className="min-w-0 flex-1 truncate font-medium text-sm">
              {request.title ?? request.tag}
            </div>
            {fullscreenButton}
            {closeButton}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-6">
            <ElementMount request={request} onSend={props.onSend} onOpen={props.onOpen} />
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

function OverlayButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      onClick={props.onClick}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-current/10 text-current outline-none hover:bg-current/20 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5",
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}

function ImageView(props: {
  readonly request: Extract<PortalRequest, { kind: "image" }>;
  readonly index: number;
  readonly fit: boolean;
  readonly onToggleFit: () => void;
  readonly onStep: (delta: 1 | -1) => void;
  readonly onClose: () => void;
  readonly actions: ReactNode;
}) {
  const { request, index, fit } = props;
  const image = request.images[index];
  const many = request.images.length > 1;
  const touch = useRef<{ x: number; y: number } | null>(null);
  if (!image) return null;
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-3 t3-portal-top pb-2">
        <div className="flex-1 text-sm tabular-nums opacity-80">
          {many ? `${index + 1} / ${request.images.length}` : ""}
        </div>
        {props.actions}
      </div>
      <div
        className="relative min-h-0 flex-1"
        onTouchStart={(event) => {
          const t = event.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(event) => {
          const start = touch.current;
          const t = event.changedTouches[0];
          touch.current = null;
          if (!start || !t || !many || !fit) return;
          const delta = swipeDelta(t.clientX - start.x, t.clientY - start.y);
          if (delta !== 0) props.onStep(delta);
        }}
      >
        <div
          className={cn("absolute inset-0 flex", fit ? "overflow-hidden p-2" : "overflow-auto")}
          // The backdrop around the image closes; the image itself toggles fit and 100%.
          onClick={(event) => event.target === event.currentTarget && props.onClose()}
        >
          <img
            key={index}
            src={image.src}
            alt={image.alt ?? image.caption ?? ""}
            draggable={false}
            onClick={props.onToggleFit}
            className={cn(
              "m-auto",
              fit
                ? "max-h-full max-w-full cursor-zoom-in object-contain"
                : "max-w-none shrink-0 cursor-zoom-out",
            )}
          />
        </div>
        {many ? (
          <>
            <OverlayButton
              label="Previous image"
              onClick={() => props.onStep(-1)}
              className="absolute top-1/2 left-3 -translate-y-1/2 bg-black/50 text-white hover:bg-black/70"
            >
              <ChevronLeftIcon />
            </OverlayButton>
            <OverlayButton
              label="Next image"
              onClick={() => props.onStep(1)}
              className="absolute top-1/2 right-3 -translate-y-1/2 bg-black/50 text-white hover:bg-black/70"
            >
              <ChevronRightIcon />
            </OverlayButton>
          </>
        ) : null}
      </div>
      {image.caption ? (
        <div className="shrink-0 t3-portal-bottom px-14 pt-2 text-center text-sm opacity-90">
          {image.caption}
        </div>
      ) : (
        <div className="t3-portal-bottom shrink-0" />
      )}
    </>
  );
}

/** The same custom element, with `fullscreen` set so it can use the room. */
function ElementMount(props: {
  readonly request: Extract<PortalRequest, { kind: "element" }>;
  readonly onSend: (event: Event) => void;
  readonly onOpen: (event: Event) => void;
}) {
  const { tag, props: elementProps } = props.request;
  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef(props);
  useEffect(() => {
    handlers.current = props;
  });

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const element = document.createElement(tag) as HTMLElement & Record<string, unknown>;
    element.fullscreen = true;
    element.setAttribute("fullscreen", "");
    element.props = elementProps;
    const onSend = (event: Event) => handlers.current.onSend(event);
    const onOpen = (event: Event) => handlers.current.onOpen(event);
    element.addEventListener("t3-send", onSend);
    element.addEventListener("t3-open", onOpen);
    container.replaceChildren(element);
    return () => {
      element.removeEventListener("t3-send", onSend);
      element.removeEventListener("t3-open", onOpen);
      element.remove();
    };
  }, [tag, elementProps]);

  return <div ref={host} className="mx-auto w-full max-w-6xl" />;
}
