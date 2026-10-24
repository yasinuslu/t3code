"use client";

import { FILL_PREVIEW_VIEWPORT, type ScopedThreadRef } from "@t3tools/contracts";
import {
  ExternalLinkIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelRightIcon,
  PictureInPicture2,
  XIcon,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useChatCanvas } from "../chat/ChatCanvasContext";
import { BrowserSurfaceSlot } from "~/browser/BrowserSurfaceSlot";
import {
  findActiveBrowserRecordingRuntimeTabId,
  useActiveBrowserRecordingTabIds,
} from "~/browser/browserRecording";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import type { BrowserViewportResizeDirection } from "~/browser/browserViewportLayout";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useThreadPreviewState } from "~/previewStateStore";
import {
  type PreviewMiniPlayerSize,
  type PreviewMiniPlayerSource,
  type PreviewMiniPlayerState,
  previewMiniPlayerSourceKey,
  usePreviewMiniPlayerStore,
} from "~/previewMiniPlayerStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { useDeviceState } from "~/state/device";

import { DeviceStreamView } from "../device/DeviceStreamView";
import type { DeviceScreenSize } from "@t3tools/client-runtime/device/stream";
import { previewBridge } from "./previewBridge";
import { openPreviewLinkExternally } from "./useOpenThreadPreviewLink";
import {
  clampPreviewMiniPlayerPosition,
  NO_PREVIEW_MINI_PLAYER_OBSTACLES,
  PREVIEW_MINI_PLAYER_CORNER_RADIUS,
  PREVIEW_MINI_PLAYER_EDGE_GAP,
  PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX,
  type PreviewMiniPlayerFrame,
  resizePreviewMiniPlayer,
  resolveDeviceMiniPlayerCornerRadius,
  resolveDeviceMiniPlayerSourceSize,
  resolvePreviewMiniPlayerSourceSize,
} from "./previewMiniPlayerLayout";

interface PointerGesture {
  readonly pointerId: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly frame: PreviewMiniPlayerFrame;
  readonly direction: BrowserViewportResizeDirection | null;
}

interface Props {
  readonly threadRef: ScopedThreadRef;
  /** Names the thread that owns the preview, since an agent may open it unasked. */
  readonly threadTitle: string | null;
  readonly miniPlayer: PreviewMiniPlayerState;
}

const frameCornerRadius = () => PREVIEW_MINI_PLAYER_CORNER_RADIUS;

// Grab zones straddling each edge; only the bottom-right corner draws a grip.
const RESIZE_HANDLES: ReadonlyArray<{
  readonly direction: BrowserViewportResizeDirection;
  readonly className: string;
}> = [
  { direction: "north", className: "inset-x-0 -top-1 h-2 cursor-ns-resize" },
  { direction: "south", className: "inset-x-0 -bottom-1 h-2 cursor-ns-resize" },
  { direction: "west", className: "inset-y-0 -left-1 w-2 cursor-ew-resize" },
  { direction: "east", className: "inset-y-0 -right-1 w-2 cursor-ew-resize" },
  { direction: "northwest", className: "-left-2 -top-2 size-4 cursor-nwse-resize" },
  { direction: "northeast", className: "-right-2 -top-2 size-4 cursor-nesw-resize" },
  { direction: "southwest", className: "-bottom-2 -left-2 size-4 cursor-nesw-resize" },
  { direction: "southeast", className: "-bottom-1.5 -right-1.5 size-6 cursor-nwse-resize" },
];

/** Floats the thread's browser tab or device stream over chat. */
export function ThreadPreviewMiniPlayer({ threadRef, threadTitle, miniPlayer }: Props) {
  const { source } = miniPlayer;
  return source.kind === "browser" ? (
    <BrowserMiniPlayer
      key={source.tabId}
      threadRef={threadRef}
      threadTitle={threadTitle}
      tabId={source.tabId}
      miniPlayer={miniPlayer}
    />
  ) : (
    <DeviceMiniPlayer
      key={previewMiniPlayerSourceKey(source)}
      threadRef={threadRef}
      threadTitle={threadTitle}
      source={source}
      miniPlayer={miniPlayer}
    />
  );
}

function BrowserMiniPlayer({
  threadRef,
  threadTitle,
  tabId,
  miniPlayer,
}: Props & { readonly tabId: string }) {
  const previewState = useThreadPreviewState(threadRef);
  const snapshot = previewState.sessions[tabId] ?? null;
  const runtimeTabId = previewRuntimeTabId(threadRef, previewState.serverEpoch, tabId);
  const recordingTabIds = useActiveBrowserRecordingTabIds();
  const recording =
    recordingTabIds.has(runtimeTabId) ||
    findActiveBrowserRecordingRuntimeTabId(threadRef, tabId) !== null;
  const desktopOverlay = previewState.desktopByTabId[tabId] ?? null;
  const fittedSourceContent = useBrowserSurfaceStore(
    (state) => state.byTabId[runtimeTabId]?.fittedSourceContent ?? null,
  );
  const sourceSize = resolvePreviewMiniPlayerSourceSize(
    snapshot?.viewport ?? FILL_PREVIEW_VIEWPORT,
    fittedSourceContent,
    desktopOverlay?.zoomFactor ?? 1,
  );

  const openInPanel = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
    useRightPanelStore.getState().openBrowser(threadRef, tabId);
  };

  const toggleNativePictureInPicture = () => {
    if (!previewBridge) return;
    const operation = desktopOverlay?.pictureInPicture
      ? previewBridge.pictureInPicture.close
      : previewBridge.pictureInPicture.open;
    void operation(runtimeTabId).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to update popped-out preview",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  };

  if (!snapshot) return null;

  const navStatus = snapshot.navStatus;
  const pageUrl = navStatus._tag === "Idle" ? null : navStatus.url;

  return (
    <MiniPlayerShell
      threadRef={threadRef}
      threadTitle={threadTitle}
      miniPlayer={miniPlayer}
      sourceSize={sourceSize}
      label="Floating browser preview"
      recording={recording}
      placeholder={pageUrl}
      onOpenInPanel={openInPanel}
      onOpenExternal={pageUrl ? () => openPreviewLinkExternally(pageUrl) : undefined}
      pillActions={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={desktopOverlay?.pictureInPicture ? "secondary" : "ghost"}
                size="icon-xs"
                aria-label={
                  desktopOverlay?.pictureInPicture
                    ? "Close popped-out preview"
                    : "Pop preview into separate window"
                }
                disabled={!desktopOverlay?.hasWebContents}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={toggleNativePictureInPicture}
              />
            }
          >
            <PictureInPicture2 />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {desktopOverlay?.pictureInPicture
              ? "Close separate window"
              : "Pop into separate window"}
          </TooltipPopup>
        </Tooltip>
      }
    >
      {(frame) => (
        <>
          <BrowserSurfaceSlot
            tabId={runtimeTabId}
            visible={Boolean(desktopOverlay?.hasWebContents)}
            cornerRadius={PREVIEW_MINI_PLAYER_CORNER_RADIUS}
            zIndex={PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX}
            fitSourceContent
            layoutVersion={`${frame.x}:${frame.y}`}
            className="absolute inset-0"
          />
          {!desktopOverlay?.hasWebContents ? (
            <div className="pointer-events-none absolute inset-0 z-[49] flex items-center justify-center rounded-[inherit] bg-muted text-xs text-muted-foreground">
              Reconnecting preview…
            </div>
          ) : null}
        </>
      )}
    </MiniPlayerShell>
  );
}

function DeviceMiniPlayer({
  threadRef,
  threadTitle,
  source,
  miniPlayer,
}: Props & { readonly source: Extract<PreviewMiniPlayerSource, { kind: "device" }> }) {
  const { state: deviceState } = useDeviceState(threadRef.environmentId);
  const [screen, setScreen] = useState<DeviceScreenSize | null>(null);
  const sourceSize = resolveDeviceMiniPlayerSourceSize(source.platform, screen);
  const device = deviceState.devices.find(
    (entry) => entry.hostId === source.hostId && entry.id === source.deviceId,
  );
  const hostLabel =
    deviceState.hosts.find((host) => host.id === source.hostId)?.label ?? "Device host";
  const cornerRadius = useCallback(
    (player: PreviewMiniPlayerSize) => resolveDeviceMiniPlayerCornerRadius(source.platform, player),
    [source.platform],
  );

  const openInPanel = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
    useRightPanelStore.getState().openDevice(threadRef, {
      hostId: source.hostId,
      deviceId: source.deviceId,
      platform: source.platform,
      name: source.name,
    });
  };

  return (
    <MiniPlayerShell
      threadRef={threadRef}
      threadTitle={threadTitle}
      miniPlayer={miniPlayer}
      sourceSize={sourceSize}
      label="Floating device preview"
      onOpenInPanel={openInPanel}
      cornerRadius={cornerRadius}
    >
      {() => (
        // The stream is DOM, so it takes the band the browser's native webview would.
        <div
          className="pointer-events-auto absolute inset-0 overflow-hidden rounded-[inherit]"
          style={{ zIndex: PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX }}
        >
          <DeviceStreamView
            environmentId={threadRef.environmentId}
            platform={source.platform}
            deviceId={source.deviceId}
            hostId={source.hostId}
            deviceName={device?.name ?? source.name}
            deviceDescription={`${hostLabel} · ${device?.version ?? source.platform}`}
            visible
            onScreen={setScreen}
          />
        </div>
      )}
    </MiniPlayerShell>
  );
}

/**
 * The frame, drag/resize gestures, and hover pill shared by every floating
 * source. Native clipping and the DOM frame use the same radius so their
 * separately composited edges stay aligned.
 */
function MiniPlayerShell({
  threadRef,
  threadTitle,
  miniPlayer,
  sourceSize,
  label,
  onOpenInPanel,
  onOpenExternal,
  placeholder,
  pillActions,
  recording = false,
  cornerRadius = frameCornerRadius,
  children,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly threadTitle: string | null;
  readonly miniPlayer: PreviewMiniPlayerState;
  readonly sourceSize: PreviewMiniPlayerSize;
  readonly label: string;
  readonly onOpenInPanel: () => void;
  /** Opens the page in the system browser; absent when the source has no URL. */
  readonly onOpenExternal?: (() => void) | undefined;
  /** Shown on the player's backdrop, so a page that has not painted still says what it is. */
  readonly placeholder?: string | null | undefined;
  readonly pillActions?: ReactNode;
  readonly recording?: boolean;
  /** The clip radius for a given frame; the pill stays inside the curve. */
  readonly cornerRadius?: (frame: PreviewMiniPlayerSize) => number;
  readonly children: (frame: PreviewMiniPlayerFrame) => ReactNode;
}) {
  const canvas = useChatCanvas();
  const gestureRef = useRef<PointerGesture | null>(null);
  const container = canvas?.container ?? null;
  const obstacles = NO_PREVIEW_MINI_PLAYER_OBSTACLES;
  const sourceKey = previewMiniPlayerSourceKey(miniPlayer.source);
  const frame = canvas?.previewKey === sourceKey ? canvas.layout.frame : null;
  const { width: sourceWidth, height: sourceHeight } = sourceSize;
  const reportPreview = canvas?.reportPreview;
  const clearPreview = canvas?.clearPreview;
  useLayoutEffect(() => {
    reportPreview?.({
      key: sourceKey,
      width: miniPlayer.width,
      position: miniPlayer.position,
      lastInteraction: miniPlayer.lastInteraction,
      source: { width: sourceWidth, height: sourceHeight },
    });
  }, [
    reportPreview,
    sourceKey,
    miniPlayer.width,
    miniPlayer.position,
    miniPlayer.lastInteraction,
    sourceWidth,
    sourceHeight,
  ]);
  useLayoutEffect(() => () => clearPreview?.(sourceKey), [clearPreview, sourceKey]);

  const radius = frame ? cornerRadius(frame) : PREVIEW_MINI_PLAYER_CORNER_RADIUS;
  // Inside a wide curve the default 8px inset would land on the clipped-away corner.
  const pillInset = Math.max(8, Math.round(radius * 0.55));

  const close = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
  };

  // Enlarging remembers the frame it came from, so the same button puts it back.
  const [restoreFrame, setRestoreFrame] = useState<PreviewMiniPlayerFrame | null>(null);
  const maximised = restoreFrame !== null;
  const toggleMaximised = () => {
    if (!frame || !container) return;
    const store = usePreviewMiniPlayerStore.getState();
    if (restoreFrame) {
      store.resize(threadRef, sourceKey, restoreFrame.width, {
        x: restoreFrame.x,
        y: restoreFrame.y,
      });
      setRestoreFrame(null);
      return;
    }
    // The layout clamps the width to what the container holds at the source aspect ratio.
    store.resize(threadRef, sourceKey, container.width, {
      x: PREVIEW_MINI_PLAYER_EDGE_GAP,
      y: PREVIEW_MINI_PLAYER_EDGE_GAP,
    });
    setRestoreFrame(frame);
  };

  const sectionRef = useRef<HTMLElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const syncLayer = useCallback(() => {
    const section = sectionRef.current;
    const layer = layerRef.current;
    if (!section || !layer) return;
    const rect = section.getBoundingClientRect();
    layer.style.left = `${rect.left}px`;
    layer.style.top = `${rect.top}px`;
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;
  }, []);
  // The frame changes on every drag and resize step, each of which re-renders the shell.
  useLayoutEffect(syncLayer);
  const hasFrame = frame !== null;
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!hasFrame || !section) return;
    // Layout shifts around the player (sidebars, panels) move it without resizing it.
    const observer = new ResizeObserver(syncLayer);
    observer.observe(section);
    if (section.offsetParent) observer.observe(section.offsetParent);
    window.addEventListener("resize", syncLayer);
    window.addEventListener("scroll", syncLayer, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncLayer);
      window.removeEventListener("scroll", syncLayer, true);
    };
  }, [hasFrame, syncLayer]);

  const beginGesture = (
    event: ReactPointerEvent<HTMLElement>,
    direction: BrowserViewportResizeDirection | null,
  ) => {
    if (event.button !== 0 || !frame) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      frame,
      direction,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !container) return;
    const delta = { x: event.clientX - gesture.pointerX, y: event.clientY - gesture.pointerY };
    const store = usePreviewMiniPlayerStore.getState();
    if (gesture.direction === null) {
      store.move(
        threadRef,
        sourceKey,
        clampPreviewMiniPlayerPosition(
          { x: gesture.frame.x + delta.x, y: gesture.frame.y + delta.y },
          container,
          gesture.frame,
          obstacles,
        ),
      );
      return;
    }
    const next = resizePreviewMiniPlayer({
      start: gesture.frame,
      direction: gesture.direction,
      delta,
      source: sourceSize,
      container,
      obstacles,
    });
    store.resize(threadRef, sourceKey, next.width, { x: next.x, y: next.y });
  };

  const endGesture = (event: ReactPointerEvent<HTMLElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0">
      {frame ? (
        <section
          ref={sectionRef}
          aria-label={label}
          data-preview-mini-player={sourceKey}
          className="pointer-events-none absolute select-none"
          style={{
            left: frame.x,
            top: frame.y,
            width: frame.width,
            height: frame.height,
            borderRadius: radius,
          }}
        >
          <div className="absolute inset-0 z-[47] flex items-center justify-center rounded-[inherit] bg-muted px-4 shadow-2xl/35">
            {placeholder ? (
              <span className="line-clamp-2 break-all text-center text-xs text-muted-foreground">
                {placeholder}
              </span>
            ) : null}
          </div>
          {children(frame)}
        </section>
      ) : null}
      {/* The native webview is composited at the window level (z 48) and Home's overlay
          is a stacking context below it, so controls rendered here would sit under the
          page. They live in a window-level layer that follows the section instead. */}
      {frame
        ? createPortal(
            <div
              ref={layerRef}
              className="pointer-events-none fixed z-[49]"
              style={{ borderRadius: radius }}
            >
              <div
                className="pointer-events-auto absolute z-[49] flex h-8 max-w-[calc(100%-1rem)] touch-none cursor-grab items-center gap-0.5 rounded-lg border border-border/80 bg-popover/92 p-0.5 shadow-lg/20 backdrop-blur-xl active:cursor-grabbing"
                style={{ right: pillInset, top: pillInset }}
                onPointerDown={(event) => beginGesture(event, null)}
                onPointerMove={handlePointerMove}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
              >
                {recording ? (
                  <span
                    role="status"
                    aria-label="Recording preview"
                    className="flex size-6 shrink-0 items-center justify-center"
                  >
                    <span className="size-2 rounded-full bg-destructive motion-safe:animate-status-pulse" />
                  </span>
                ) : null}
                {threadTitle ? (
                  <span className="min-w-0 truncate px-1.5 text-xs text-muted-foreground">
                    {threadTitle}
                  </span>
                ) : null}
                <PillAction
                  label={maximised ? "Restore floating preview size" : "Enlarge floating preview"}
                  onClick={toggleMaximised}
                >
                  {maximised ? <Minimize2Icon /> : <Maximize2Icon />}
                </PillAction>
                <PillAction label="Open preview in right panel" onClick={onOpenInPanel}>
                  <PanelRightIcon />
                </PillAction>
                {onOpenExternal ? (
                  <PillAction label="Open in external browser" onClick={onOpenExternal}>
                    <ExternalLinkIcon />
                  </PillAction>
                ) : null}
                {pillActions}
                <PillAction label="Close floating preview" onClick={close}>
                  <XIcon />
                </PillAction>
              </div>
              <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-border/80" />
              {RESIZE_HANDLES.map(({ direction, className }) => (
                <div
                  key={direction}
                  role="presentation"
                  data-preview-mini-player-resize={direction}
                  className={cn("pointer-events-auto absolute touch-none", className)}
                  onPointerDown={(event) => beginGesture(event, direction)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={endGesture}
                  onPointerCancel={endGesture}
                >
                  {direction === "southeast" ? (
                    <svg
                      aria-hidden
                      viewBox="0 0 12 12"
                      className="absolute right-2 bottom-2 size-3 text-foreground/70"
                    >
                      <path
                        d="M11 3 3 11M11 7 7 11"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** A pill button; its pointer-down must not start the pill's drag gesture. */
function PillAction({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
