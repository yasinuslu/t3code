import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  shell: null as Record<string, unknown> | null,
  environments: new Map<string, { label: string }>(),
  navigate: vi.fn(),
  copy: vi.fn(async () => true),
  showContextMenu: vi.fn(),
}));
vi.mock("~/state/entities", () => ({ useThreadShell: () => mocks.shell }));
vi.mock("~/state/environments", () => ({
  useEnvironment: (id: string) => mocks.environments.get(id) ?? null,
  usePrimaryEnvironmentId: () => "local",
}));
vi.mock("~/hooks/useCopyToClipboard", () => ({ writeTextToClipboard: mocks.copy }));
vi.mock("~/localApi", () => ({
  readLocalApi: () => ({ contextMenu: { show: mocks.showContextMenu } }),
}));
vi.mock("./ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Link: (props: { children?: ReactNode; params: unknown }) => (
    <a data-params={JSON.stringify(props.params)} {...props} />
  ),
}));
vi.mock("./ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: ReactNode }) => render,
  TooltipPopup: ({ children }: { children: ReactNode }) => <span role="tooltip">{children}</span>,
}));

import { ThreadContextChip } from "./ThreadContextChip";

const record = {
  environmentId: EnvironmentId.make("remote"),
  threadId: ThreadId.make("mcp:c1097b24"),
  title: "Link text",
};

let renderer: ReactTestRenderer;

function mount() {
  act(() => {
    renderer = create(<ThreadContextChip record={record} />);
  });
  return renderer.root.findByType("a");
}

function text(): string {
  const collect = (node: unknown): string =>
    typeof node === "string"
      ? node
      : Array.isArray(node)
        ? node.map(collect).join("")
        : node && typeof node === "object" && "children" in node
          ? collect((node as { children: unknown }).children)
          : "";
  return collect(renderer.toJSON());
}

const pointer = { clientX: 4, clientY: 8, preventDefault: vi.fn(), stopPropagation: vi.fn() };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.shell = null;
  mocks.environments = new Map([
    ["local", { label: "This machine" }],
    ["remote", { label: "nika" }],
  ]);
  mocks.navigate.mockReset();
  mocks.copy.mockClear();
  mocks.showContextMenu.mockReset();
});

afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("ThreadContextChip", () => {
  it("shows the live title, its environment and status for a known thread", () => {
    mocks.shell = {
      title: "Live title",
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      runtime: { status: "running" },
      settledOverride: null,
    };
    const link = mount();
    expect(text()).toContain("Live titlenika");
    expect(text()).toContain("Open thread · Working");
    expect(link.props["aria-label"]).toBe("Thread, Live title, Working");
    expect(link.props.className).not.toContain("border-dashed");

    mocks.shell = { ...mocks.shell, runtime: null, hasPendingUserInput: true };
    act(() => renderer.update(<ThreadContextChip record={record} />));
    expect(text()).toContain("Needs input");
    mocks.shell = { ...mocks.shell, hasPendingUserInput: false, settledOverride: "settled" };
    act(() => renderer.update(<ThreadContextChip record={record} />));
    expect(text()).toContain("Settled");
  });

  it("hides the environment label for a thread on the current environment", () => {
    mocks.shell = { title: "Here", runtime: null, settledOverride: null };
    act(() => {
      renderer = create(
        <ThreadContextChip record={record} currentEnvironmentId={record.environmentId} />,
      );
    });
    expect(text()).not.toContain("nika");
    expect(text()).toContain("Ready");
  });

  it("falls back to a muted chip with the link text for an unknown thread", () => {
    mocks.environments.delete("remote");
    const link = mount();
    expect(text()).toContain("Link text");
    expect(text()).toContain("not connected");
    expect(link.props.className).toContain("border-dashed");
    expect(link.props["aria-label"]).toBe("Thread, Link text");
  });

  it("copies the thread link on Cmd/Ctrl-click and from the context menu", async () => {
    const link = mount();
    act(() => link.props.onClick({ ...pointer, metaKey: true, ctrlKey: false }));
    expect(mocks.copy).toHaveBeenCalledWith("t3code://threads/remote/mcp%3Ac1097b24", "link");

    mocks.showContextMenu.mockResolvedValueOnce("open");
    await act(async () => link.props.onContextMenu(pointer));
    expect(mocks.showContextMenu.mock.lastCall![0].map((item: { id: string }) => item.id)).toEqual([
      "open",
      "copy-link",
    ]);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "remote", threadId: "mcp:c1097b24" },
    });

    mocks.showContextMenu.mockResolvedValueOnce("copy-link");
    await act(async () => link.props.onContextMenu(pointer));
    expect(mocks.copy).toHaveBeenCalledTimes(2);
  });
});
