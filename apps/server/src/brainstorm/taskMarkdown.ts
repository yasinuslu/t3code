/**
 * A task list kept as a plain markdown checklist that people also edit by hand
 * (in an editor or Obsidian):
 *
 * ```md
 * - [ ] Fix the flaky login test
 *   Only fails on CI. See https://example.com/issue/1
 *   - thread: 0f6c…
 * - [x] Ship the release
 * ```
 *
 * A task is a top-level `- [ ]` / `- [x]` item (`*` and `+` bullets work too).
 * The lines indented under it are its body: notes, links, nested items, and
 * `thread: <id>` lines that link it to T3 Code threads. Everything else in the
 * file (headings, prose, blank lines) is kept as it is.
 *
 * Edits never rewrite the file: each one changes, inserts or removes only the
 * lines of the one task it touches, so hand edits elsewhere survive.
 */

export interface ParsedTask {
  /** 1-based position among the file's tasks. */
  readonly number: number;
  readonly title: string;
  readonly done: boolean;
  /** Body lines that are not thread links, with the task's indent removed. */
  readonly notes: ReadonlyArray<string>;
  readonly threadIds: ReadonlyArray<string>;
  /** 0-based index of the task line. */
  readonly line: number;
  /** 0-based index one past the task's last body line. */
  readonly end: number;
}

export interface ParsedTaskFile {
  readonly tasks: ReadonlyArray<ParsedTask>;
  readonly lines: ReadonlyArray<string>;
  readonly eol: "\n" | "\r\n";
  readonly trailingNewline: boolean;
}

const TASK_LINE = /^( {0,3})([-*+]) \[( |x|X)\](?:[ \t]+(.*?))?[ \t]*$/;
const THREAD_LINE = /^\s*(?:[-*+]\s+)?thread:\s*(\S+)\s*$/i;
const FENCE = /^\s{0,3}(```|~~~)/;

const indentOf = (line: string) => line.length - line.trimStart().length;
const isBlank = (line: string) => line.trim().length === 0;

export function parseTaskMarkdown(text: string): ParsedTaskFile {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = text.endsWith("\n");
  const body = trailingNewline ? text.slice(0, text.endsWith("\r\n") ? -2 : -1) : text;
  const lines = text.length === 0 ? [] : body.split(/\r?\n/);
  const tasks: ParsedTask[] = [];
  let inFence = false;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (FENCE.test(line)) {
      inFence = !inFence;
      index += 1;
      continue;
    }
    const match = inFence ? null : TASK_LINE.exec(line);
    if (!match) {
      index += 1;
      continue;
    }
    const indent = match[1]!.length;
    // Body: lines indented past the bullet. Blank lines belong to the body
    // only when more body follows them.
    let end = index + 1;
    let cursor = index + 1;
    while (cursor < lines.length) {
      const next = lines[cursor]!;
      if (isBlank(next)) {
        cursor += 1;
        continue;
      }
      if (indentOf(next) <= indent) break;
      cursor += 1;
      end = cursor;
    }
    const bodyLines = lines.slice(index + 1, end);
    const threadIds: string[] = [];
    const notes: string[] = [];
    const bodyIndent = Math.min(
      ...bodyLines.filter((entry) => !isBlank(entry)).map(indentOf),
      Number.POSITIVE_INFINITY,
    );
    for (const entry of bodyLines) {
      const thread = THREAD_LINE.exec(entry);
      if (thread) {
        if (!threadIds.includes(thread[1]!)) threadIds.push(thread[1]!);
      } else {
        notes.push(isBlank(entry) ? "" : entry.slice(bodyIndent));
      }
    }
    tasks.push({
      number: tasks.length + 1,
      title: (match[4] ?? "").trim(),
      done: match[3] !== " ",
      notes,
      threadIds,
      line: index,
      end,
    });
    index = end;
  }
  return { tasks, lines, eol, trailingNewline };
}

function serialize(file: ParsedTaskFile, lines: ReadonlyArray<string>): string {
  if (lines.length === 0) return "";
  // An edit to an empty or unterminated file still ends it with a newline.
  return lines.join(file.eol) + (file.trailingNewline || file.lines.length === 0 ? file.eol : "");
}

const oneLine = (value: string) => value.replace(/\s*\r?\n\s*/g, " ").trim();

/** Body lines for a task at `indent`, notes first and thread links last. */
function bodyLinesFor(
  indent: number,
  notes: ReadonlyArray<string>,
  threadIds: ReadonlyArray<string>,
): string[] {
  const pad = " ".repeat(indent + 2);
  return [
    ...notes.flatMap((note) => note.split(/\r?\n/)).map((note) => (note ? pad + note : "")),
    ...threadIds.map((threadId) => `${pad}- thread: ${threadId}`),
  ];
}

/** Which task a reference names: its 1-based number, or its title. */
export type TaskReference = number | string;

export class TaskNotFoundError extends Error {
  readonly reference: TaskReference;
  constructor(reference: TaskReference) {
    super(
      typeof reference === "number"
        ? `There is no task ${reference}.`
        : `No task matches "${reference}".`,
    );
    this.reference = reference;
  }
}

export class TaskAmbiguousError extends Error {
  readonly reference: string;
  readonly candidates: ReadonlyArray<ParsedTask>;
  constructor(reference: string, candidates: ReadonlyArray<ParsedTask>) {
    super(
      `"${reference}" matches ${candidates.length} tasks: ${candidates
        .map((task) => `${task.number}. ${task.title}`)
        .join("; ")}. Pass the task number.`,
    );
    this.reference = reference;
    this.candidates = candidates;
  }
}

/**
 * Finds a task by number, or by title: an exact (case-insensitive) title wins,
 * otherwise a unique title containing the text.
 */
export function findTask(file: ParsedTaskFile, reference: TaskReference): ParsedTask {
  if (typeof reference === "number") {
    const task = file.tasks[reference - 1];
    if (!task) throw new TaskNotFoundError(reference);
    return task;
  }
  const wanted = reference.trim().toLowerCase();
  if (/^\d+$/.test(wanted)) return findTask(file, Number(wanted));
  const exact = file.tasks.filter((task) => task.title.toLowerCase() === wanted);
  if (exact.length === 1) return exact[0]!;
  const partial =
    exact.length > 1
      ? exact
      : file.tasks.filter((task) => task.title.toLowerCase().includes(wanted));
  if (partial.length === 1) return partial[0]!;
  if (partial.length === 0) throw new TaskNotFoundError(reference);
  throw new TaskAmbiguousError(reference, partial);
}

export interface NewTask {
  readonly title: string;
  readonly notes?: ReadonlyArray<string>;
  readonly threadIds?: ReadonlyArray<string>;
  readonly done?: boolean;
}

/** Appends a task after the last one, or at the end of the file. */
export function addTask(text: string, task: NewTask): { text: string; number: number } {
  const file = parseTaskMarkdown(text);
  const last = file.tasks.at(-1);
  const indent = last ? (TASK_LINE.exec(file.lines[last.line]!)?.[1]?.length ?? 0) : 0;
  const bullet = last ? (TASK_LINE.exec(file.lines[last.line]!)?.[2] ?? "-") : "-";
  const newLines = [
    `${" ".repeat(indent)}${bullet} [${task.done ? "x" : " "}] ${oneLine(task.title)}`,
    ...bodyLinesFor(indent, task.notes ?? [], task.threadIds ?? []),
  ];
  const lines = [...file.lines];
  if (last) {
    lines.splice(last.end, 0, ...newLines);
  } else {
    // Keep a blank line between existing prose and the list.
    while (lines.length > 0 && isBlank(lines.at(-1)!)) lines.pop();
    if (lines.length > 0) lines.push("");
    lines.push(...newLines);
  }
  return { text: serialize(file, lines), number: file.tasks.length + 1 };
}

export interface TaskPatch {
  readonly title?: string;
  readonly done?: boolean;
  /** Replaces the task's notes; thread links are kept. */
  readonly notes?: ReadonlyArray<string>;
  readonly addThreadIds?: ReadonlyArray<string>;
  readonly removeThreadIds?: ReadonlyArray<string>;
}

/** Applies a patch to one task, touching only that task's lines. */
export function updateTask(
  text: string,
  reference: TaskReference,
  patch: TaskPatch,
): { text: string; task: ParsedTask } {
  const file = parseTaskMarkdown(text);
  const task = findTask(file, reference);
  const lines = [...file.lines];
  const match = TASK_LINE.exec(lines[task.line]!)!;
  const indent = match[1]!.length;
  const title = patch.title === undefined ? (match[4] ?? "").trim() : oneLine(patch.title);
  const done = patch.done ?? task.done;
  if (patch.title !== undefined || patch.done !== undefined) {
    const mark = done ? (task.done ? match[3]! : "x") : " ";
    lines[task.line] = `${match[1]}${match[2]} [${mark}]${title ? ` ${title}` : ""}`;
  }

  const body = lines.slice(task.line + 1, task.end);
  let nextBody = body;
  if (patch.notes !== undefined) {
    // Rebuild the notes, keep the thread lines exactly as written.
    nextBody = [
      ...bodyLinesFor(indent, patch.notes, []),
      ...body.filter((entry) => THREAD_LINE.test(entry)),
    ];
  }
  const removed = new Set(patch.removeThreadIds ?? []);
  if (removed.size > 0) {
    nextBody = nextBody.filter((entry) => {
      const thread = THREAD_LINE.exec(entry);
      return !thread || !removed.has(thread[1]!);
    });
  }
  const present = new Set(
    nextBody.flatMap((entry) => {
      const thread = THREAD_LINE.exec(entry);
      return thread ? [thread[1]!] : [];
    }),
  );
  const added = [...new Set(patch.addThreadIds ?? [])].filter((id) => !present.has(id));
  if (added.length > 0) {
    // Drop trailing blank body lines so the link sits right under the task's content.
    while (nextBody.length > 0 && isBlank(nextBody.at(-1)!)) nextBody = nextBody.slice(0, -1);
    nextBody = [...nextBody, ...bodyLinesFor(indent, [], added)];
  }
  if (nextBody !== body) lines.splice(task.line + 1, body.length, ...nextBody);
  const nextText = serialize(file, lines);
  const updated = parseTaskMarkdown(nextText).tasks[task.number - 1]!;
  return { text: nextText, task: updated };
}

/** Removes one task and its body. */
export function deleteTask(
  text: string,
  reference: TaskReference,
): { text: string; task: ParsedTask } {
  const file = parseTaskMarkdown(text);
  const task = findTask(file, reference);
  const lines = [...file.lines];
  lines.splice(task.line, task.end - task.line);
  return { text: lines.length === 0 ? "" : serialize(file, lines), task };
}
