import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { growEntry } from "./returns.logic";
import { useReturnActions } from "./GrowReturns";
import { usePendingDecisions } from "./grow.decide";
import { growEnvironment } from "../../state/grow";
import { threadEnvironment } from "../../state/threads";

const commands = vi.hoisted(() => ({
  startTurn: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../ChatView", () => ({ default: () => null }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
  useMemo: (create: () => unknown) => create(),
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => {
    switch (command) {
      case threadEnvironment.startTurn:
        return commands.startTurn;
      case growEnvironment.update:
        return commands.update;
      default:
        return vi.fn();
    }
  },
}));

const item = growEntry(
  {
    id: ThreadId.make("thread"),
    environmentId: EnvironmentId.make("env"),
    title: "Studio upgrade",
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: "2026-10-23T08:00:00.000Z",
    latestUserMessageAt: null,
    latestRun: null,
    runtime: null,
    pullRequests: [],
    previewLinks: [],
    lineage: { relationshipToParent: null },
  } as unknown as EnvironmentThreadShell,
  undefined,
  "urgent",
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  for (const command of Object.values(commands)) {
    command.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  }
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Grow actions that send a message", () => {
  it.each(["reply", "whatIf"] as const)(
    "a %s goes at once and leaves the thread on screen",
    async (kind) => {
      const moveOn = vi.fn();
      await useReturnActions(moveOn).whatIf(item, "use the blue one", kind);
      expect(commands.startTurn).toHaveBeenCalledTimes(1);
      expect(moveOn).not.toHaveBeenCalled();
      expect(usePendingDecisions.getState().keys.size).toBe(0);
    },
  );

  it("a decision still moves on and waits out its undo window", () => {
    const moveOn = vi.fn();
    useReturnActions(moveOn).settle(item);
    expect(moveOn).toHaveBeenCalledExactlyOnceWith(item);
    expect(usePendingDecisions.getState().keys.has(item.key)).toBe(true);
  });
});
