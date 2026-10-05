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
 * Tasks are grouped under goals: a `## Goal title` heading starts a goal, and
 * `## [x] Goal title` marks it done. Prose under a goal heading is its notes.
 * Tasks above the first goal heading belong to the Inbox, as do tasks under a
 * `## Inbox` heading.
 *
 * ```md
 * ## Inbox
 * - [ ] Something nobody planned yet
 *
 * ## Ship the manager screen
 * One place to run every goal.
 * - [ ] Board UI
 *   - thread: 0f6c…
 * ```
 *
 * Edits never rewrite the file: each one changes, inserts or removes only the
 * lines of the one task or goal heading it touches, so hand edits elsewhere
 * survive.
 */

export interface ParsedTask {
  /** 1-based position among the file's tasks. */
  readonly number: number;
  readonly title: string;
  readonly done: boolean;
  /** Body lines that are not thread links, with the task's indent removed. */
  readonly notes: ReadonlyArray<string>;
  readonly threadIds: ReadonlyArray<string>;
  /** Title of the goal the task sits under; Inbox above the first goal. */
  readonly goal: string;
  /** 0-based index of the task line. */
  readonly line: number;
  /** 0-based index one past the task's last body line. */
  readonly end: number;
}

export const INBOX_GOAL = "Inbox";

export interface ParsedGoal {
  /** 1-based position among the file's goals. */
  readonly number: number;
  readonly title: string;
  readonly done: boolean;
  /** Prose lines under the heading that are not tasks. */
  readonly notes: ReadonlyArray<string>;
  /** 0-based index of the heading; null for the Inbox of tasks above every heading. */
  readonly line: number | null;
  /** 0-based index one past the goal's last line. */
  readonly end: number;
}

export interface ParsedTaskFile {
  readonly tasks: ReadonlyArray<ParsedTask>;
  readonly goals: ReadonlyArray<ParsedGoal>;
  readonly lines: ReadonlyArray<string>;
  readonly eol: "\n" | "\r\n";
  readonly trailingNewline: boolean;
}

const TASK_LINE = /^( {0,3})([-*+]) \[( |x|X)\](?:[ \t]+(.*?))?[ \t]*$/;
const THREAD_LINE = /^\s*(?:[-*+]\s+)?thread:\s*(\S+)\s*$/i;
const FENCE = /^\s{0,3}(```|~~~)/;
/** A level-2 heading, optionally with a `[ ]` / `[x]` mark: a goal. */
const GOAL_LINE = /^##[ \t]+(?:\[( |x|X)\][ \t]+)?(.*?)(?:[ \t]+#+)?[ \t]*$/;

const indentOf = (line: string) => line.length - line.trimStart().length;
const isBlank = (line: string) => line.trim().length === 0;

export function parseTaskMarkdown(text: string): ParsedTaskFile {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = text.endsWith("\n");
  const body = trailingNewline ? text.slice(0, text.endsWith("\r\n") ? -2 : -1) : text;
  const lines = text.length === 0 ? [] : body.split(/\r?\n/);
  const tasks: Omit<ParsedTask, "goal">[] = [];
  const headings: number[] = [];
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
      if (!inFence && GOAL_LINE.test(line)) headings.push(index);
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
  const goals = goalsOf(lines, headings, tasks);
  const goalAt = (line: number) =>
    goals.findLast((goal) => (goal.line ?? -1) <= line)?.title ?? INBOX_GOAL;
  return {
    tasks: tasks.map((task) => ({ ...task, goal: goalAt(task.line) })),
    goals,
    lines,
    eol,
    trailingNewline,
  };
}

function goalsOf(
  lines: ReadonlyArray<string>,
  headings: ReadonlyArray<number>,
  tasks: ReadonlyArray<Pick<ParsedTask, "line" | "end">>,
): ParsedGoal[] {
  const goals: ParsedGoal[] = [];
  const firstHeading = headings[0] ?? lines.length;
  if (tasks.some((task) => task.line < firstHeading)) {
    goals.push({
      number: 1,
      title: INBOX_GOAL,
      done: false,
      notes: [],
      line: null,
      end: firstHeading,
    });
  }
  headings.forEach((line, position) => {
    const match = GOAL_LINE.exec(lines[line]!)!;
    const end = headings[position + 1] ?? lines.length;
    const notes: string[] = [];
    for (let cursor = line + 1; cursor < end; cursor += 1) {
      const task = tasks.find((candidate) => candidate.line === cursor);
      if (task) {
        cursor = task.end - 1;
        continue;
      }
      if (!isBlank(lines[cursor]!)) notes.push(lines[cursor]!.trim());
    }
    goals.push({
      number: goals.length + 1,
      title: (match[2] ?? "").trim(),
      done: match[1] !== undefined && match[1] !== " ",
      notes,
      line,
      end,
    });
  });
  return goals;
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
  /** The goal to add it under (number or title); the Inbox when unset. */
  readonly goal?: TaskReference;
}

export class GoalNotFoundError extends Error {
  readonly reference: TaskReference;
  constructor(reference: TaskReference) {
    super(
      typeof reference === "number"
        ? `There is no goal ${reference}.`
        : `No goal matches "${reference}". Add it first.`,
    );
    this.reference = reference;
  }
}

export class GoalConflictError extends Error {}

const isInboxReference = (reference: TaskReference) =>
  typeof reference === "string" && reference.trim().toLowerCase() === INBOX_GOAL.toLowerCase();

/**
 * Finds a goal by number, or by title: an exact (case-insensitive) title wins,
 * otherwise a unique title containing the text. "Inbox" only matches exactly.
 */
export function findGoal(file: ParsedTaskFile, reference: TaskReference): ParsedGoal {
  if (typeof reference === "number") {
    const goal = file.goals[reference - 1];
    if (!goal) throw new GoalNotFoundError(reference);
    return goal;
  }
  const wanted = reference.trim().toLowerCase();
  if (/^\d+$/.test(wanted)) return findGoal(file, Number(wanted));
  const exact = file.goals.filter((goal) => goal.title.toLowerCase() === wanted);
  // A written `## Inbox` heading wins over the tasks above every heading.
  const written = exact.find((goal) => goal.line !== null) ?? exact[0];
  if (written) return written;
  if (isInboxReference(reference)) throw new GoalNotFoundError(reference);
  const partial = file.goals.filter((goal) => goal.title.toLowerCase().includes(wanted));
  if (partial.length === 1) return partial[0]!;
  if (partial.length === 0) throw new GoalNotFoundError(reference);
  throw new GoalConflictError(
    `"${reference}" matches ${partial.length} goals: ${partial
      .map((goal) => `${goal.number}. ${goal.title}`)
      .join("; ")}. Pass the goal number.`,
  );
}

/** The goal a reference names, or null for an Inbox the file does not have yet. */
function resolveGoal(file: ParsedTaskFile, reference: TaskReference): ParsedGoal | null {
  try {
    return findGoal(file, reference);
  } catch (error) {
    if (error instanceof GoalNotFoundError && isInboxReference(reference)) return null;
    throw error;
  }
}

/**
 * Inserts a task block as the last task of a goal, creating the Inbox (first,
 * above every other goal) when it is missing. `block` gets the indent and
 * bullet of the tasks it joins. Returns the lines and the block's first line.
 */
function placeInGoal(
  file: ParsedTaskFile,
  reference: TaskReference,
  block: (indent: number, bullet: string) => ReadonlyArray<string>,
): { lines: string[]; at: number } {
  const lines = [...file.lines];
  const styleOf = (task: ParsedTask | undefined) => {
    const match = task ? TASK_LINE.exec(file.lines[task.line]!) : null;
    return { indent: match?.[1]?.length ?? 0, bullet: match?.[2] ?? "-" };
  };
  const goal = resolveGoal(file, reference);
  if (goal !== null) {
    const last = file.tasks.findLast(
      (task) => task.line > (goal.line ?? -1) && task.line < goal.end,
    );
    if (last) {
      const style = styleOf(last);
      lines.splice(last.end, 0, ...block(style.indent, style.bullet));
      return { lines, at: last.end };
    }
    // An empty goal: right under its heading and notes.
    const heading = goal.line ?? -1;
    let at = goal.end;
    while (at > heading + 1 && isBlank(lines[at - 1]!)) at -= 1;
    const prefix = at - 1 > heading ? [""] : [];
    const suffix = at < lines.length && !isBlank(lines[at]!) ? [""] : [];
    lines.splice(at, 0, ...prefix, ...block(0, styleOf(file.tasks.at(-1)).bullet), ...suffix);
    return { lines, at: at + prefix.length };
  }
  const newLines = block(0, styleOf(file.tasks.at(-1)).bullet);
  const firstHeading = file.goals.find((candidate) => candidate.line !== null)?.line ?? null;
  if (firstHeading !== null) {
    const prefix = firstHeading > 0 && !isBlank(lines[firstHeading - 1]!) ? [""] : [];
    lines.splice(firstHeading, 0, ...prefix, `## ${INBOX_GOAL}`, ...newLines, "");
    return { lines, at: firstHeading + prefix.length + 1 };
  }
  while (lines.length > 0 && isBlank(lines.at(-1)!)) lines.pop();
  if (lines.length > 0) lines.push("");
  lines.push(`## ${INBOX_GOAL}`);
  const at = lines.length;
  lines.push(...newLines);
  return { lines, at };
}

/** Adds a task as the last one of its goal (the Inbox by default). */
export function addTask(text: string, task: NewTask): { text: string; number: number } {
  const file = parseTaskMarkdown(text);
  const placed = placeInGoal(file, task.goal ?? INBOX_GOAL, (indent, bullet) => [
    `${" ".repeat(indent)}${bullet} [${task.done ? "x" : " "}] ${oneLine(task.title)}`,
    ...bodyLinesFor(indent, task.notes ?? [], task.threadIds ?? []),
  ]);
  const nextText = serialize(file, placed.lines);
  const added = parseTaskMarkdown(nextText).tasks.find((entry) => entry.line === placed.at)!;
  return { text: nextText, number: added.number };
}

export interface NewGoal {
  readonly title: string;
  readonly notes?: ReadonlyArray<string>;
  readonly done?: boolean;
}

const noteLines = (notes: ReadonlyArray<string>) =>
  notes
    .flatMap((note) => note.split(/\r?\n/))
    .map((note) => note.trim())
    .filter((note) => note.length > 0);

const goalHeading = (title: string, done: boolean, marked: boolean) =>
  `## ${done ? "[x] " : marked ? "[ ] " : ""}${title}`;

/** Appends a goal heading (and its notes) at the end of the file. */
export function addGoal(text: string, goal: NewGoal): { text: string; number: number } {
  const file = parseTaskMarkdown(text);
  const title = oneLine(goal.title);
  if (title.length === 0) throw new GoalConflictError("A goal needs a title.");
  if (file.goals.some((existing) => existing.title.toLowerCase() === title.toLowerCase())) {
    throw new GoalConflictError(`There is already a goal "${title}".`);
  }
  const lines = [...file.lines];
  while (lines.length > 0 && isBlank(lines.at(-1)!)) lines.pop();
  if (lines.length > 0) lines.push("");
  lines.push(goalHeading(title, goal.done === true, false), ...noteLines(goal.notes ?? []));
  const nextText = serialize(file, lines);
  return { text: nextText, number: parseTaskMarkdown(nextText).goals.length };
}

export interface GoalPatch {
  readonly title?: string;
  readonly done?: boolean;
  /** Replaces the prose between the heading and the goal's first task. */
  readonly notes?: ReadonlyArray<string>;
}

/** Renames a goal, marks it done or open, or replaces its notes. */
export function updateGoal(
  text: string,
  reference: TaskReference,
  patch: GoalPatch,
): { text: string; goal: ParsedGoal } {
  let file = parseTaskMarkdown(text);
  let goal = findGoal(file, reference);
  if (goal.line === null) {
    // The Inbox of loose tasks gets a heading of its own to carry the change.
    file = parseTaskMarkdown(migrateToGoals(text));
    goal = file.goals[goal.number - 1]!;
  }
  const line = goal.line!;
  const lines = [...file.lines];
  const title = patch.title === undefined ? goal.title : oneLine(patch.title);
  if (title.length === 0) throw new GoalConflictError("A goal needs a title.");
  if (
    file.goals.some(
      (other) => other.number !== goal.number && other.title.toLowerCase() === title.toLowerCase(),
    )
  ) {
    throw new GoalConflictError(`There is already a goal "${title}".`);
  }
  if (patch.title !== undefined || patch.done !== undefined) {
    const marked = GOAL_LINE.exec(lines[line]!)?.[1] !== undefined;
    lines[line] = goalHeading(title, patch.done ?? goal.done, marked);
  }
  if (patch.notes !== undefined) {
    const firstTask = file.tasks.find((task) => task.line > line && task.line < goal.end);
    let regionEnd = firstTask?.line ?? goal.end;
    while (regionEnd > line + 1 && isBlank(lines[regionEnd - 1]!)) regionEnd -= 1;
    lines.splice(line + 1, regionEnd - (line + 1), ...noteLines(patch.notes));
  }
  const nextText = serialize(file, lines);
  return { text: nextText, goal: parseTaskMarkdown(nextText).goals[goal.number - 1]! };
}

/** Removes an empty goal's heading and notes; a goal with tasks stays. */
export function deleteGoal(
  text: string,
  reference: TaskReference,
): { text: string; goal: ParsedGoal } {
  const file = parseTaskMarkdown(text);
  const goal = findGoal(file, reference);
  const tasks = file.tasks.filter((task) => task.line > (goal.line ?? -1) && task.line < goal.end);
  if (tasks.length > 0 || goal.line === null) {
    throw new GoalConflictError(
      `Goal "${goal.title}" still has ${tasks.length} task(s); move or delete them first.`,
    );
  }
  const lines = [...file.lines];
  lines.splice(goal.line, goal.end - goal.line);
  return { text: lines.length === 0 ? "" : serialize(file, lines), goal };
}

/**
 * Gives tasks above the first goal heading an explicit `## Inbox` heading, so
 * a task list from before goals existed reads the same as a new one. Returns
 * the text unchanged when there is nothing to do.
 */
export function migrateToGoals(text: string): string {
  const file = parseTaskMarkdown(text);
  if (!file.goals.some((goal) => goal.line === null)) return text;
  const first = file.tasks[0]!;
  const lines = [...file.lines];
  const prefix = first.line > 0 && !isBlank(lines[first.line - 1]!) ? [""] : [];
  lines.splice(first.line, 0, ...prefix, `## ${INBOX_GOAL}`);
  return serialize(file, lines);
}

export interface TaskPatch {
  readonly title?: string;
  readonly done?: boolean;
  /** Replaces the task's notes; thread links are kept. */
  readonly notes?: ReadonlyArray<string>;
  readonly addThreadIds?: ReadonlyArray<string>;
  readonly removeThreadIds?: ReadonlyArray<string>;
  /** Moves the task to the end of this goal (number or title). */
  readonly goal?: TaskReference;
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
  const updated = parseTaskMarkdown(nextText);
  const moving = updated.tasks[task.number - 1]!;
  if (patch.goal === undefined) return { text: nextText, task: moving };
  const target = resolveGoal(updated, patch.goal);
  if (target !== null && target.title === moving.goal) return { text: nextText, task: moving };
  const rest = [...updated.lines];
  const block = rest.splice(moving.line, moving.end - moving.line);
  // Don't leave a blank line at the top or two in a row where the task was.
  if (
    moving.line < rest.length &&
    isBlank(rest[moving.line]!) &&
    (moving.line === 0 || isBlank(rest[moving.line - 1]!))
  ) {
    rest.splice(moving.line, 1);
  }
  const without = parseTaskMarkdown(rest.length === 0 ? "" : serialize(updated, rest));
  const placed = placeInGoal(without, patch.goal, () => block);
  const movedText = serialize(without, placed.lines);
  return {
    text: movedText,
    task: parseTaskMarkdown(movedText).tasks.find((entry) => entry.line === placed.at)!,
  };
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
