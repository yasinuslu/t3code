import { describe, expect, it } from "vite-plus/test";

import {
  addGoal,
  addTask,
  deleteGoal,
  deleteTask,
  findGoal,
  findTask,
  GoalConflictError,
  GoalNotFoundError,
  migrateToGoals,
  parseTaskMarkdown,
  TaskAmbiguousError,
  TaskNotFoundError,
  updateGoal,
  updateTask,
} from "./taskMarkdown.ts";

const HAND_WRITTEN = [
  "# Tasks",
  "",
  "Some prose the user wrote.",
  "",
  "- [ ] Fix the flaky login test",
  "  Only fails on CI.",
  "",
  "  See https://example.com/issue/1",
  "  - thread: thread-a",
  "  - [ ] a nested sub-item stays in the body",
  "* [x] Ship the release",
  "+ [X]   Upper-case X counts as done   ",
  "",
  "## Later",
  "",
  "```md",
  "- [ ] not a task, inside a fence",
  "```",
  "- [ ] Write docs",
  "",
].join("\n");

describe("parseTaskMarkdown", () => {
  it("finds top-level checklist items with their notes and thread links", () => {
    const file = parseTaskMarkdown(HAND_WRITTEN);
    expect(file.tasks.map((task) => [task.number, task.title, task.done])).toEqual([
      [1, "Fix the flaky login test", false],
      [2, "Ship the release", true],
      [3, "Upper-case X counts as done", true],
      [4, "Write docs", false],
    ]);
    const first = file.tasks[0]!;
    expect(first.threadIds).toEqual(["thread-a"]);
    expect(first.notes).toEqual([
      "Only fails on CI.",
      "",
      "See https://example.com/issue/1",
      "- [ ] a nested sub-item stays in the body",
    ]);
  });

  it("does not claim trailing blank lines or dedented prose as a body", () => {
    const file = parseTaskMarkdown("- [ ] one\n\nprose\n");
    expect(file.tasks[0]!.end).toBe(1);
  });

  it("parses an empty file and one without a trailing newline", () => {
    expect(parseTaskMarkdown("").tasks).toEqual([]);
    expect(parseTaskMarkdown("- [ ] last").tasks[0]!.title).toBe("last");
  });

  it("accepts CRLF files", () => {
    const file = parseTaskMarkdown("- [ ] a\r\n  - thread: t1\r\n- [x] b\r\n");
    expect(file.eol).toBe("\r\n");
    expect(file.tasks.map((task) => task.title)).toEqual(["a", "b"]);
    expect(file.tasks[0]!.threadIds).toEqual(["t1"]);
  });
});

describe("edits keep hand-written content", () => {
  const unchangedOutside = (before: string, after: string, touched: ReadonlyArray<string>) => {
    const keep = (text: string) => text.split("\n").filter((line) => !touched.includes(line));
    expect(keep(after)).toEqual(keep(before));
  };

  it("completing a task flips only its checkbox", () => {
    const { text } = updateTask(HAND_WRITTEN, 1, { done: true });
    expect(text).toBe(
      HAND_WRITTEN.replace("- [ ] Fix the flaky login test", "- [x] Fix the flaky login test"),
    );
  });

  it("reopening keeps the bullet style", () => {
    const { text } = updateTask(HAND_WRITTEN, 2, { done: false });
    expect(text).toBe(HAND_WRITTEN.replace("* [x] Ship the release", "* [ ] Ship the release"));
  });

  it("a no-op done patch leaves an upper-case X alone", () => {
    const { text } = updateTask(HAND_WRITTEN, 3, { done: true });
    expect(text).toBe(
      HAND_WRITTEN.replace(
        "+ [X]   Upper-case X counts as done   ",
        "+ [X] Upper-case X counts as done",
      ),
    );
  });

  it("renaming rewrites the one title line", () => {
    const { text, task } = updateTask(HAND_WRITTEN, "write docs", { title: "Write the docs" });
    expect(task.title).toBe("Write the docs");
    expect(text).toBe(HAND_WRITTEN.replace("- [ ] Write docs", "- [ ] Write the docs"));
  });

  it("adds a task to the end of the Inbox and round-trips it", () => {
    const { text, number } = addTask(HAND_WRITTEN, {
      title: "New thing",
      notes: ["why it matters"],
      threadIds: ["thread-b"],
    });
    // The tasks above the first goal heading are the Inbox; "Write docs" is under "Later".
    expect(number).toBe(4);
    expect(text).toContain(
      "+ [X]   Upper-case X counts as done   \n+ [ ] New thing\n  why it matters\n  - thread: thread-b\n\n## Later",
    );
    const task = parseTaskMarkdown(text).tasks[3]!;
    expect(task).toMatchObject({
      title: "New thing",
      done: false,
      notes: ["why it matters"],
      threadIds: ["thread-b"],
      goal: "Inbox",
    });
    unchangedOutside(HAND_WRITTEN, text, [
      "+ [ ] New thing",
      "  why it matters",
      "  - thread: thread-b",
    ]);
  });

  it("adds the first task under a new Inbox heading", () => {
    expect(addTask("# Tasks\n", { title: "one" }).text).toBe("# Tasks\n\n## Inbox\n- [ ] one\n");
    expect(addTask("", { title: "one" }).text).toBe("## Inbox\n- [ ] one\n");
  });

  it("flattens a multi-line title", () => {
    expect(addTask("", { title: "  two\nlines " }).text).toBe("## Inbox\n- [ ] two lines\n");
  });

  it("links and unlinks threads without touching the notes", () => {
    const linked = updateTask(HAND_WRITTEN, 1, { addThreadIds: ["thread-a", "thread-c"] });
    expect(linked.task.threadIds).toEqual(["thread-a", "thread-c"]);
    expect(linked.text).toContain(
      "  - [ ] a nested sub-item stays in the body\n  - thread: thread-c\n",
    );
    const unlinked = updateTask(linked.text, 1, { removeThreadIds: ["thread-a"] });
    expect(unlinked.task.threadIds).toEqual(["thread-c"]);
    expect(unlinked.task.notes).toEqual(linked.task.notes);
  });

  it("replacing notes keeps thread links", () => {
    const { task } = updateTask(HAND_WRITTEN, 1, { notes: ["just this"] });
    expect(task.notes).toEqual(["just this"]);
    expect(task.threadIds).toEqual(["thread-a"]);
  });

  it("deletes a task with its body and nothing else", () => {
    const { text, task } = deleteTask(HAND_WRITTEN, 1);
    expect(task.title).toBe("Fix the flaky login test");
    expect(text).toBe(
      HAND_WRITTEN.replace(
        [
          "- [ ] Fix the flaky login test",
          "  Only fails on CI.",
          "",
          "  See https://example.com/issue/1",
          "  - thread: thread-a",
          "  - [ ] a nested sub-item stays in the body",
          "",
        ].join("\n"),
        "",
      ),
    );
  });

  it("keeps CRLF line endings on edit", () => {
    const { text } = updateTask("- [ ] a\r\n- [ ] b\r\n", 2, { done: true });
    expect(text).toBe("- [ ] a\r\n- [x] b\r\n");
  });

  it("an edit after a manual change re-reads the file first", () => {
    // Someone inserts a task above in Obsidian; a title reference still hits the right one.
    const edited = HAND_WRITTEN.replace(
      "- [ ] Write docs",
      "- [ ] Inserted by hand\n- [ ] Write docs",
    );
    const { text } = updateTask(edited, "Write docs", { done: true });
    expect(text).toContain("- [ ] Inserted by hand\n- [x] Write docs");
  });
});

describe("findTask", () => {
  const file = parseTaskMarkdown("- [ ] Fix login\n- [ ] Fix logout\n- [ ] Docs\n");

  it("takes a number, a numeric string, or a title", () => {
    expect(findTask(file, 3).title).toBe("Docs");
    expect(findTask(file, "2").title).toBe("Fix logout");
    expect(findTask(file, "docs").title).toBe("Docs");
    expect(findTask(file, "logout").title).toBe("Fix logout");
  });

  it("rejects missing and ambiguous references", () => {
    expect(() => findTask(file, 9)).toThrow(TaskNotFoundError);
    expect(() => findTask(file, "nothing")).toThrow(TaskNotFoundError);
    expect(() => findTask(file, "fix")).toThrow(TaskAmbiguousError);
  });
});

const GOALS = [
  "# Tasks",
  "",
  "## Inbox",
  "- [ ] Loose idea",
  "",
  "## Ship the manager screen ##",
  "One place to run every goal.",
  "",
  "- [ ] Board UI",
  "  - thread: thread-a",
  "- [x] Tool scope",
  "",
  "## [x] Old goal",
  "- [x] Done thing",
  "",
].join("\n");

describe("goals", () => {
  it("reads goal headings, done marks, notes, and which goal each task is under", () => {
    const file = parseTaskMarkdown(GOALS);
    expect(file.goals.map((goal) => [goal.number, goal.title, goal.done, goal.notes])).toEqual([
      [1, "Inbox", false, []],
      [2, "Ship the manager screen", false, ["One place to run every goal."]],
      [3, "Old goal", true, []],
    ]);
    expect(file.tasks.map((task) => [task.number, task.title, task.goal])).toEqual([
      [1, "Loose idea", "Inbox"],
      [2, "Board UI", "Ship the manager screen"],
      [3, "Tool scope", "Ship the manager screen"],
      [4, "Done thing", "Old goal"],
    ]);
  });

  it("treats tasks above every goal heading as the Inbox, and level 1 or 3 headings as prose", () => {
    const file = parseTaskMarkdown("# Title\n- [ ] a\n### not a goal\n- [ ] b\n## Goal\n- [ ] c\n");
    expect(file.goals.map((goal) => [goal.title, goal.line])).toEqual([
      ["Inbox", null],
      ["Goal", 4],
    ]);
    expect(file.tasks.map((task) => task.goal)).toEqual(["Inbox", "Inbox", "Goal"]);
  });

  it("adds a task as the last one of a named goal", () => {
    const { text, number } = addTask(GOALS, { title: "Needs-you strip", goal: "manager" });
    expect(number).toBe(4);
    expect(text).toContain("- [x] Tool scope\n- [ ] Needs-you strip\n\n## [x] Old goal");
  });

  it("adds a task to an empty goal under its notes", () => {
    const withGoal = addGoal(GOALS, { title: "Empty", notes: ["why"] }).text;
    const { text } = addTask(withGoal, { title: "first", goal: "Empty" });
    expect(text.endsWith("## Empty\nwhy\n\n- [ ] first\n")).toBe(true);
    expect(parseTaskMarkdown(text).tasks.at(-1)!.goal).toBe("Empty");
  });

  it("refuses an unknown goal instead of guessing", () => {
    expect(() => addTask(GOALS, { title: "x", goal: "Nope" })).toThrow(GoalNotFoundError);
  });

  it("creates the Inbox above the other goals when it is missing", () => {
    const { text } = addTask("# Tasks\n\n## Goal\n- [ ] g\n", { title: "loose" });
    expect(text).toBe("# Tasks\n\n## Inbox\n- [ ] loose\n\n## Goal\n- [ ] g\n");
  });

  it("adds, renames, completes and annotates goals by touching only their heading and notes", () => {
    const added = addGoal(GOALS, { title: "New goal", notes: ["line one"] });
    expect(added.number).toBe(4);
    expect(
      added.text.endsWith("## [x] Old goal\n- [x] Done thing\n\n## New goal\nline one\n"),
    ).toBe(true);
    const done = updateGoal(GOALS, "manager", { done: true });
    expect(done.goal).toMatchObject({ title: "Ship the manager screen", done: true });
    expect(done.text).toBe(
      GOALS.replace("## Ship the manager screen ##", "## [x] Ship the manager screen"),
    );
    const reopened = updateGoal(GOALS, "Old goal", { done: false, title: "Older goal" });
    expect(reopened.text).toContain("## [ ] Older goal\n");
    const noted = updateGoal(GOALS, 2, { notes: ["Replaced.", "Two lines."] });
    expect(noted.goal.notes).toEqual(["Replaced.", "Two lines."]);
    expect(noted.text).toContain(
      "## Ship the manager screen ##\nReplaced.\nTwo lines.\n\n- [ ] Board UI",
    );
  });

  it("rejects duplicate and ambiguous goal titles", () => {
    expect(() => addGoal(GOALS, { title: "inbox" })).toThrow(GoalConflictError);
    expect(() => updateGoal(GOALS, "Old goal", { title: "Inbox" })).toThrow(GoalConflictError);
    const two = addGoal(GOALS, { title: "Ship docs" }).text;
    expect(() => findGoal(parseTaskMarkdown(two), "ship")).toThrow(GoalConflictError);
  });

  it("moves a task with its body to another goal", () => {
    const { text, task } = updateTask(GOALS, "Board UI", { goal: "Inbox" });
    expect(task).toMatchObject({
      number: 2,
      title: "Board UI",
      goal: "Inbox",
      threadIds: ["thread-a"],
    });
    expect(text).toContain("## Inbox\n- [ ] Loose idea\n- [ ] Board UI\n  - thread: thread-a\n");
    expect(text).toContain("One place to run every goal.\n\n- [x] Tool scope\n");
  });

  it("deletes only an empty goal", () => {
    expect(() => deleteGoal(GOALS, "Old goal")).toThrow(GoalConflictError);
    const withEmpty = addGoal(GOALS, { title: "Empty" }).text;
    expect(deleteGoal(withEmpty, "Empty").text).toBe(`${GOALS}\n`);
  });
});

describe("migrateToGoals", () => {
  it("puts tasks from before goals under an Inbox heading and loses nothing", () => {
    const legacy = [
      "- [ ] one",
      "  note",
      "  - thread: t1",
      "- [x] two",
      "  - done: something",
      "",
    ].join("\n");
    const migrated = migrateToGoals(legacy);
    expect(migrated).toBe(`## Inbox\n${legacy}`);
    const before = parseTaskMarkdown(legacy).tasks;
    const after = parseTaskMarkdown(migrated).tasks;
    expect(
      after.map(({ title, done, notes, threadIds }) => ({ title, done, notes, threadIds })),
    ).toEqual(
      before.map(({ title, done, notes, threadIds }) => ({ title, done, notes, threadIds })),
    );
    expect(after.every((task) => task.goal === "Inbox")).toBe(true);
  });

  it("keeps a blank line after prose and leaves goal files alone", () => {
    expect(migrateToGoals("# Tasks\nprose\n- [ ] a\n")).toBe(
      "# Tasks\nprose\n\n## Inbox\n- [ ] a\n",
    );
    expect(migrateToGoals(GOALS)).toBe(GOALS);
    expect(migrateToGoals("")).toBe("");
  });
});
