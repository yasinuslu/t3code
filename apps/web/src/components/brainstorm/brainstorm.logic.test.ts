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
  it("lists each tool call with its name and input, and skips other items", () => {
    const steps = toolStepsOf([
      {
        id: "i1",
        type: "user_message",
        status: "completed",
        title: null,
        at: "2026-09-28T00:00:00Z",
      },
      {
        id: "i2",
        type: "dynamic_tool",
        status: "completed",
        title: "MCP tool call",
        toolName: "mcp__t3-code__add_task",
        input: { title: "X" },
        at: "2026-09-28T00:00:01Z",
      },
      {
        id: "i3",
        type: "dynamic_tool",
        status: "running",
        title: null,
        toolName: "mcp__t3-code__list_tasks",
        input: {},
        at: "2026-09-28T00:00:02Z",
      },
      {
        id: "i4",
        type: "command_execution",
        status: "failed",
        title: "Run command",
        input: "git   status\n--short",
        at: "2026-09-28T00:00:03Z",
      },
      {
        id: "i5",
        type: "assistant_message",
        status: "completed",
        title: null,
        at: "2026-09-28T00:00:04Z",
      },
    ]);
    expect(steps).toEqual([
      { id: "i2", label: 'add_task {"title":"X"}', done: true, at: "2026-09-28T00:00:01Z" },
      { id: "i3", label: "list_tasks", done: false, at: "2026-09-28T00:00:02Z" },
      { id: "i4", label: "Run command git status --short", done: true, at: "2026-09-28T00:00:03Z" },
    ]);
  });

  it("shortens long labels", () => {
    const [step] = toolStepsOf([
      {
        id: "i1",
        type: "dynamic_tool",
        status: "completed",
        title: null,
        toolName: "mcp__t3-code__add_task",
        input: { title: "x".repeat(400) },
        at: "2026-09-28T00:00:01Z",
      },
    ]);
    expect(step!.label).toHaveLength(140);
    expect(step!.label.endsWith("…")).toBe(true);
  });
});

describe("brainstormActivity", () => {
  const base = {
    runStatus: "completed",
    lastError: null,
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
    for (const runStatus of ["preparing", "queued", "starting", "running", "waiting"]) {
      expect(brainstormActivity({ ...base, runStatus })).toEqual({ kind: "thinking" });
    }
    expect(brainstormActivity({ ...base, runStatus: "idle" })).toEqual({ kind: "idle" });
    expect(brainstormActivity({ ...base, runStatus: "interrupted" })).toEqual({ kind: "idle" });
  });

  it("puts prompts and failures ahead of silence", () => {
    expect(
      brainstormActivity({ ...base, hasPendingApprovals: true, runStatus: "running" }),
    ).toEqual({
      kind: "needs-input",
      what: "approval",
    });
    expect(brainstormActivity({ ...base, hasPendingUserInput: true })).toEqual({
      kind: "needs-input",
      what: "answer",
    });
    expect(
      brainstormActivity({ ...base, runStatus: "failed", lastError: "Not logged in" }),
    ).toEqual({ kind: "error", message: "Not logged in" });
    expect(brainstormActivity({ ...base, runStatus: "failed" })).toEqual({
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
