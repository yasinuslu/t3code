import { compile } from "tailwindcss";
import themeCss from "tailwindcss/theme.css?raw";

import appCss from "../index.css?raw";

/**
 * Tailwind for widgets T3 was not built with: the frame's stylesheet only holds the classes T3's
 * own source uses, so a widget's other classes are compiled here, against T3's theme.
 */
let compiler: Promise<Awaited<ReturnType<typeof compile>>> | null = null;
const seen = new Set<string>();
let style: HTMLStyleElement | null = null;

function load() {
  compiler ??= compile(
    [
      '@import "tailwindcss/theme.css" layer(theme);',
      '@import "tailwindcss/utilities.css" layer(utilities);',
      appCss.replace(/^@import "tailwindcss";$/m, ""),
    ].join("\n"),
    {
      base: "/",
      loadStylesheet: async (id) => ({
        path: id,
        base: "/",
        content: id === "tailwindcss/theme.css" ? themeCss : "@tailwind utilities;",
      }),
    },
  );
  return compiler;
}

/** Adds the classes these widget sources use; cheap when they are already known. */
export async function addWidgetClasses(sources: ReadonlyArray<string>): Promise<void> {
  const fresh: string[] = [];
  for (const source of sources) {
    for (const candidate of source.split(/[\s"'`{}()<>,;=]+/)) {
      if (candidate.length > 0 && candidate.length < 120 && !seen.has(candidate)) {
        seen.add(candidate);
        fresh.push(candidate);
      }
    }
  }
  if (fresh.length === 0) return;
  const css = (await load()).build([...seen]);
  if (style === null) {
    style = document.createElement("style");
    style.dataset.widgets = "";
    document.head.append(style);
  }
  style.textContent = css;
}
