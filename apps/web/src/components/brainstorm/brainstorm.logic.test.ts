import {
  type KeybindingShortcut,
  type ModelSelection,
  ProviderInstanceId,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { initialSpaceState, type Space } from "../../spaceStore";
import {
  brainstormAccelerator,
  brainstormActivity,
  brainstormModelChoice,
  brainstormModelSelection,
  brainstormModelsOffered,
  brainstormSpacesInput,
  isBrainstormModelShortcut,
  membershipChangesToAdopt,
  otherBrainstormModel,
  shortcutToAccelerator,
  toolStepsOf,
} from "./brainstorm.logic";

const shortcut = (
  key: string,
  modifiers: Partial<KeybindingShortcut> = {},
): KeybindingShortcut => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  modKey: false,
  ...modifiers,
});

describe("brainstormSpacesInput", () => {
  it("classifies spaces and keeps only this environment's memberships", () => {
    const profile: Space = {
      id: "space-yu",
      name: "yu",
      color: "blue",
      icon: { kind: "monogram", text: "YU", color: "blue" },
      profile: "yu",
    };
    const custom: Space = { ...profile, id: "space-x", name: "Side", profile: null };
    const input = brainstormSpacesInput(
      {
        spaces: [initialSpaceState.spaces[0]!, profile, custom, initialSpaceState.spaces[1]!],
        customSpaceIdsByProjectKey: {
          "env-1:project-a": ["space-x"],
          "env-2:project-b": ["space-x"],
        },
      },
      "env-1",
    );
    expect(input.spaces.map((space) => [space.id, space.kind])).toEqual([
      ["all", "all"],
      ["space-yu", "profile"],
      ["space-x", "custom"],
      ["other", "other"],
    ]);
    expect(input.customSpaceIdsByProjectId).toEqual({ "project-a": ["space-x"] });
  });
});

describe("membershipChangesToAdopt", () => {
  it("adds and removes memberships to match the server for one environment", () => {
    expect(
      membershipChangesToAdopt(
        { "env-1:a": ["s1"], "env-1:b": ["s2"], "env-2:c": ["s1"] },
        { a: ["s1", "s3"], d: ["s2"] },
        "env-1",
      ),
    ).toEqual([
      ["env-1:a", "s3", true],
      ["env-1:d", "s2", true],
      ["env-1:b", "s2", false],
    ]);
  });
});

describe("shortcutToAccelerator", () => {
  it("maps keybinding shortcuts to Electron accelerators", () => {
    expect(shortcutToAccelerator(shortcut(" ", { modKey: true, shiftKey: true }))).toBe(
      "CommandOrControl+Shift+Space",
    );
    expect(shortcutToAccelerator(shortcut("b", { ctrlKey: true, altKey: true }))).toBe(
      "Control+Alt+B",
    );
    expect(shortcutToAccelerator(shortcut("f5", { metaKey: true }))).toBe("Super+F5");
    expect(shortcutToAccelerator(shortcut("arrowup", { modKey: true }))).toBe(
      "CommandOrControl+Up",
    );
  });

  it("never registers a bare key system-wide", () => {
    expect(shortcutToAccelerator(shortcut("b"))).toBeNull();
  });

  it("uses the last unconditional binding of the command", () => {
    const keybindings = [
      { command: "brainstorm.toggle", shortcut: shortcut(" ", { modKey: true, shiftKey: true }) },
      {
        command: "brainstorm.toggle",
        shortcut: shortcut("b", { modKey: true }),
        whenAst: { type: "identifier", name: "terminalFocus" },
      },
      { command: "chat.new", shortcut: shortcut("n", { modKey: true }) },
    ] as ResolvedKeybindingsConfig;
    expect(brainstormAccelerator(keybindings)).toBe("CommandOrControl+Shift+Space");
    expect(brainstormAccelerator([])).toBeNull();
  });
});

describe("toolStepsOf", () => {
  it("collapses each call to its latest state and names the tool", () => {
    const activity = (id: string, kind: string, callId: string, detail: string, at: string) => ({
      id,
      tone: "tool",
      kind,
      summary: "MCP tool call",
      payload: { toolCallId: callId, detail, data: { toolName: "mcp__t3-code__add_task" } },
      createdAt: at,
    });
    const steps = toolStepsOf([
      activity("a1", "tool.started", "c1", "mcp__t3-code__add_task: {}", "2026-09-28T00:00:01Z"),
      activity(
        "a2",
        "tool.completed",
        "c1",
        'mcp__t3-code__add_task: {"title":"X"}',
        "2026-09-28T00:00:02Z",
      ),
      {
        ...activity("a3", "context-window.updated", "c2", "", "2026-09-28T00:00:03Z"),
        tone: "info",
      },
    ]);
    expect(steps).toEqual([
      { id: "c1", label: 'add_task {"title":"X"}', done: true, at: "2026-09-28T00:00:01Z" },
    ]);
  });
});

describe("brainstormActivity", () => {
  const base = {
    sessionStatus: "ready",
    sessionError: null,
    latestTurnState: "completed",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    awaitingSince: null,
    lastAnswerAt: "2026-09-28T10:00:00Z",
  } as const;

  it("is thinking from the send until an answer lands", () => {
    const sent = { ...base, awaitingSince: "2026-09-28T11:00:00Z" };
    expect(brainstormActivity(sent)).toEqual({ kind: "thinking" });
    expect(brainstormActivity({ ...sent, lastAnswerAt: "2026-09-28T11:00:30Z" })).toEqual({
      kind: "idle",
    });
    expect(brainstormActivity({ ...base, sessionStatus: "running" })).toEqual({ kind: "thinking" });
  });

  it("puts prompts and failures ahead of silence", () => {
    expect(
      brainstormActivity({ ...base, hasPendingApprovals: true, sessionStatus: "running" }),
    ).toEqual({
      kind: "needs-input",
      what: "approval",
    });
    expect(brainstormActivity({ ...base, hasPendingUserInput: true })).toEqual({
      kind: "needs-input",
      what: "answer",
    });
    expect(
      brainstormActivity({ ...base, sessionStatus: "error", sessionError: "Not logged in" }),
    ).toEqual({ kind: "error", message: "Not logged in" });
    expect(brainstormActivity({ ...base, latestTurnState: "error" })).toEqual({
      kind: "error",
      message: "The last turn failed.",
    });
  });
});

describe("brainstorm model", () => {
  const claude = ProviderInstanceId.make("claudeAgent");
  const opus: ModelSelection = {
    instanceId: claude,
    model: "claude-opus-5-5",
    options: [{ id: "contextWindow", value: "1m" }],
  };

  it("defaults to Sonnet until the user toggles", () => {
    expect(brainstormModelChoice(undefined)).toBe("sonnet");
    expect(brainstormModelChoice("bogus")).toBe("sonnet");
    expect(brainstormModelChoice("opus")).toBe("opus");
    expect(otherBrainstormModel("sonnet")).toBe("opus");
    expect(otherBrainstormModel("opus")).toBe("sonnet");
  });

  it("moves an Opus thread to Sonnet on the same instance, dropping Opus options", () => {
    expect(brainstormModelSelection(opus, brainstormModelChoice(undefined))).toEqual({
      instanceId: claude,
      model: "claude-sonnet-5-5",
    });
  });

  it("keeps the selection untouched when it already has the chosen model", () => {
    expect(brainstormModelSelection(opus, "opus")).toBe(opus);
  });

  it("switches only instances that offer both models", () => {
    expect(
      brainstormModelsOffered([
        { slug: "claude-fable-5-1" },
        { slug: "claude-opus-5-5" },
        { slug: "claude-sonnet-5-5" },
      ]),
    ).toBe(true);
    expect(brainstormModelsOffered([{ slug: "claude-opus-5-5" }])).toBe(false);
    expect(brainstormModelsOffered(undefined)).toBe(false);
  });

  it("flips on Cmd+/ on macOS and Ctrl+/ elsewhere", () => {
    const key = (modifiers: Partial<KeyboardEvent>) => ({
      key: "/",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...modifiers,
    });
    expect(isBrainstormModelShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isBrainstormModelShortcut(key({ ctrlKey: true }), true)).toBe(false);
    expect(isBrainstormModelShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isBrainstormModelShortcut(key({ metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isBrainstormModelShortcut(key({}), true)).toBe(false);
  });
});
