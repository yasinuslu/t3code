import type { ScopedThreadRef, ThreadPreviewLink } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const states = new Map([
  ["https://a.example", "stopped"],
  ["https://b.example", "running"],
  ["https://c.example", "gone"],
]);
const usePreviewLinkStates = vi.fn(
  (_environmentId: string, _urls: ReadonlyArray<string>) => states,
);
vi.mock("~/state/previewLinks", () => ({
  usePreviewLinkStates: (environmentId: string, urls: ReadonlyArray<string>) =>
    usePreviewLinkStates(environmentId, urls),
}));
vi.mock("~/state/threads", () => ({ threadEnvironment: { unlinkPreview: {} } }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
const openPreviewLinkExternally = vi.fn();
vi.mock("./useOpenThreadPreviewLink", () => ({
  useOpenThreadPreviewLink: () => vi.fn(),
  openPreviewLinkExternally: (url: string) => openPreviewLinkExternally(url),
}));

import { ThreadPreviewLinkList } from "./ThreadPreviewLinkChip";

const threadRef = { environmentId: "env-1", threadId: "thread-1" } as ScopedThreadRef;
const link = (url: string, linkedAt: string): ThreadPreviewLink =>
  ({ url, source: "agent", linkedAt }) as ThreadPreviewLink;
const links = [
  link("https://a.example", "2026-01-01T00:00:00.000Z"),
  link("https://b.example", "2026-01-03T00:00:00.000Z"),
  link("https://c.example", "2026-01-02T00:00:00.000Z"),
];

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
  renderer?.unmount();
  renderer = null;
});

describe("ThreadPreviewLinkList", () => {
  it("lists every link newest first with its state, and opens or removes the one clicked", () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    act(() => {
      renderer = create(
        <ThreadPreviewLinkList
          threadRef={threadRef}
          links={links}
          onOpen={onOpen}
          onRemove={onRemove}
        />,
      );
    });
    const buttons = renderer!.root.findAllByType("button");
    expect(buttons.map((button) => button.props["aria-label"])).toEqual([
      "Open preview b, Running",
      "Remove preview b",
      "Open preview c, Preview removed",
      "Remove preview c",
      "Open preview a, Stopped: opening wakes it",
      "Remove preview a",
    ]);
    // The list polls every link it shows, not just the newest.
    expect(usePreviewLinkStates).toHaveBeenCalledWith("env-1", [
      "https://b.example",
      "https://c.example",
      "https://a.example",
    ]);

    act(() => buttons[4]!.props.onClick());
    expect(onOpen).toHaveBeenCalledWith("https://a.example", "stopped");
    act(() => buttons[3]!.props.onClick());
    expect(onRemove).toHaveBeenCalledWith("https://c.example");
  });

  it("opens a row in the system browser on middle-click, except a removed preview", () => {
    act(() => {
      renderer = create(
        <ThreadPreviewLinkList
          threadRef={threadRef}
          links={links}
          onOpen={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
    });
    const buttons = renderer!.root.findAllByType("button");
    const middle = (index: number) => {
      const event = { button: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      act(() => buttons[index]!.props.onMouseDown(event));
      act(() => buttons[index]!.props.onAuxClick(event));
      return event;
    };

    const event = middle(0);
    expect(openPreviewLinkExternally).toHaveBeenCalledExactlyOnceWith("https://b.example");
    // mousedown cancels autoscroll, auxclick cancels the paste and keeps the row from activating.
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);

    openPreviewLinkExternally.mockClear();
    middle(2);
    expect(openPreviewLinkExternally).not.toHaveBeenCalled();

    const right = { button: 2, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    act(() => buttons[0]!.props.onAuxClick(right));
    expect(openPreviewLinkExternally).not.toHaveBeenCalled();
    expect(right.preventDefault).not.toHaveBeenCalled();
  });
});
