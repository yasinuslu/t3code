import { type OrchestrationV2Actor, ScheduledTaskId } from "@t3tools/contracts";

const LEGACY_AUTOMATION_PREFIX = /^\[Triggered by schedule task: [^\r\n]+\]\r?\n\r?\n/;
const LEGACY_AUTOMATION_MESSAGE_ID = /^scheduled-task-message:(.+):\d+:(?:scheduled|manual)$/;

/** Older scheduled messages stored their attribution in the prompt itself. */
export function resolveUserMessagePresentation(message: {
  readonly id?: string;
  readonly role: string;
  readonly text: string;
  readonly createdBy?: OrchestrationV2Actor;
  readonly scheduledTaskId?: ScheduledTaskId;
}) {
  if (message.role !== "user") {
    return { text: message.text, isAutomation: false, scheduledTaskId: undefined };
  }
  if (message.scheduledTaskId !== undefined) {
    return { text: message.text, isAutomation: true, scheduledTaskId: message.scheduledTaskId };
  }
  const legacyPrefix = LEGACY_AUTOMATION_PREFIX.exec(message.text);
  const legacyTaskId = legacyPrefix
    ? LEGACY_AUTOMATION_MESSAGE_ID.exec(message.id ?? "")?.[1]
    : undefined;
  const isAutomation =
    legacyPrefix !== null && (legacyTaskId !== undefined || message.createdBy === "agent");
  return {
    text: isAutomation ? message.text.slice(legacyPrefix[0].length) : message.text,
    isAutomation,
    scheduledTaskId: legacyTaskId === undefined ? undefined : ScheduledTaskId.make(legacyTaskId),
  };
}

const COMPONENT_ANSWER = /^\[Answer to: "([^"\r\n]*)"\] ([\s\S]+)$/;
const COMPONENT_QUESTION_MAX = 160;

/**
 * A component's question as one short line that can sit inside the answer prefix and be matched
 * again later: whitespace collapsed, double quotes softened, cut at a fixed length.
 */
export function normalizeComponentQuestion(question: string): string {
  const flat = question.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return flat.length > COMPONENT_QUESTION_MAX
    ? `${flat.slice(0, COMPONENT_QUESTION_MAX - 1)}…`
    : flat;
}

/**
 * The text a message carries when it answers an interactive component: the provider reads the
 * question in front of the answer, and clients split it again to show where the answer belongs.
 */
export function formatComponentAnswer(question: string, answer: string): string {
  const normalized = normalizeComponentQuestion(question);
  return normalized === "" ? answer : `[Answer to: "${normalized}"] ${answer}`;
}

export function parseComponentAnswer(
  text: string,
): { readonly question: string; readonly answer: string } | null {
  const match = COMPONENT_ANSWER.exec(text);
  return match === null ? null : { question: match[1] ?? "", answer: match[2] ?? "" };
}
