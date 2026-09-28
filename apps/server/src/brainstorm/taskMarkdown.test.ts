import { describe, expect, it } from "vite-plus/test";

import {
  addTask,
  deleteTask,
  findTask,
  parseTaskMarkdown,
  TaskAmbiguousError,
  TaskNotFoundError,
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

  it("adds a task after the last one and round-trips it", () => {
    const { text, number } = addTask(HAND_WRITTEN, {
      title: "New thing",
      notes: ["why it matters"],
      threadIds: ["thread-b"],
    });
    expect(number).toBe(5);
    expect(
      text.endsWith("- [ ] Write docs\n- [ ] New thing\n  why it matters\n  - thread: thread-b\n"),
    ).toBe(true);
    const task = parseTaskMarkdown(text).tasks[4]!;
    expect(task).toMatchObject({
      title: "New thing",
      done: false,
      notes: ["why it matters"],
      threadIds: ["thread-b"],
    });
    unchangedOutside(HAND_WRITTEN, text, [
      "- [ ] New thing",
      "  why it matters",
      "  - thread: thread-b",
    ]);
  });

  it("adds the first task to a file of prose with a blank line between", () => {
    expect(addTask("# Tasks\n", { title: "one" }).text).toBe("# Tasks\n\n- [ ] one\n");
    expect(addTask("", { title: "one" }).text).toBe("- [ ] one\n");
  });

  it("flattens a multi-line title", () => {
    expect(addTask("", { title: "  two\nlines " }).text).toBe("- [ ] two lines\n");
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
