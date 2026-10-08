import { useLayoutEffect, useRef, useState } from "react";

import { REPORT_DESIGN_VIEWPORT } from "~/browser/reportPages";

/**
 * Chromium's viewer opens with its own toolbar, a thumbnail rail and a small
 * zoom. The panel header is the only chrome we want, so ask for the page
 * alone, fitted to the panel width. Pinch and keyboard zoom, scrolling, text
 * selection and find still work inside the frame.
 */
const PDF_VIEWER_FRAGMENT = "#toolbar=0&view=FitH";

export const isPdfPreviewFile = (path: string): boolean =>
  /\.pdf$/i.test(path.split(/[?#]/, 1)[0] ?? "");

/**
 * Renders an HTML or PDF document from its URL. HTML runs in a sandboxed frame
 * with an opaque origin, so a page cannot reach the app's session or storage.
 * The built-in PDF viewer needs an unsandboxed frame; a PDF runs no scripts.
 */
export function BrowserDocumentFrame(props: {
  readonly src: string;
  readonly title: string;
  readonly pdf: boolean;
}) {
  const className = "min-h-0 flex-1 border-0 bg-white";
  return props.pdf ? (
    // oxlint-disable-next-line react/iframe-missing-sandbox
    <iframe
      key={props.src}
      src={`${props.src}${PDF_VIEWER_FRAGMENT}`}
      title={props.title}
      className={className}
    />
  ) : (
    <iframe
      key={props.src}
      src={props.src}
      title={props.title}
      className={className}
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
    />
  );
}

/**
 * Renders a report page at its design viewport, scaled to fit the frame at its
 * proportions, so the whole one-screen page is visible however wide the panel is.
 */
export function ReportDocumentFrame(props: { readonly src: string; readonly title: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const { width, height } = REPORT_DESIGN_VIEWPORT;
  const scale = size ? Math.min(size.width / width, size.height / height) : 0;
  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden bg-muted/35">
      {size ? (
        <iframe
          key={props.src}
          src={props.src}
          title={props.title}
          className="absolute border-0 bg-white"
          style={{
            width,
            height,
            left: (size.width - width * scale) / 2,
            top: (size.height - height * scale) / 2,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
        />
      ) : null}
    </div>
  );
}
