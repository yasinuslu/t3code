import {
  type GuestMessageAttribution,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type OrchestrationV2IdleCompaction,
  ScheduledTaskId,
} from "@t3tools/contracts";

/** The working row while T3 Code's own compaction runs. */
export const IDLE_COMPACTING_LABELS = {
  beforeCacheExpires: "Compacting before the cache expires…",
  onReturn: "Compacting after being idle…",
} satisfies Record<OrchestrationV2IdleCompaction, string>;

/** Leads the finished compaction's token counts, in place of "Context compacted". */
export const IDLE_COMPACTION_TITLES = {
  beforeCacheExpires: "Context automatically compacted before cache expiry",
  onReturn: "Context compacted after being idle",
} satisfies Record<OrchestrationV2IdleCompaction, string>;

const LEGACY_AUTOMATION_PREFIX = /^\[Triggered by schedule task: [^\r\n]+\]\r?\n\r?\n/;
const LEGACY_AUTOMATION_MESSAGE_ID = /^scheduled-task-message:(.+):\d+:(?:scheduled|manual)$/;

export function resolveUserMessagePresentation(message: {
  readonly id?: string;
  readonly role: string;
  readonly text: string;
  readonly createdBy?: OrchestrationV2Actor;
  readonly creationSource?: OrchestrationV2CreationSource;
  readonly scheduledTaskId?: ScheduledTaskId | undefined;
  readonly context?: { readonly guest?: GuestMessageAttribution | undefined } | undefined;
}): {
  readonly text: string;
  readonly attribution: "automation" | "agent" | "t3code" | "guest" | null;
  readonly scheduledTaskId: ScheduledTaskId | undefined;
  /** Set when `attribution` is "guest". */
  readonly guestName?: string;
} {
  if (message.role !== "user") {
    return { text: message.text, attribution: null, scheduledTaskId: undefined };
  }
  // The stored text names the guest for the agent; people see the guest's own words.
  const guest = message.context?.guest;
  if (guest !== undefined) {
    return {
      text: guest.text,
      attribution: "guest",
      scheduledTaskId: undefined,
      guestName: guest.name,
    };
  }
  if (message.scheduledTaskId !== undefined) {
    return {
      text: message.text,
      attribution: "automation",
      scheduledTaskId: message.scheduledTaskId,
    };
  }
  const legacyPrefix = LEGACY_AUTOMATION_PREFIX.exec(message.text);
  const legacyTaskId = legacyPrefix
    ? LEGACY_AUTOMATION_MESSAGE_ID.exec(message.id ?? "")?.[1]
    : undefined;
  if (legacyPrefix !== null && (legacyTaskId !== undefined || message.createdBy === "agent")) {
    return {
      text: message.text.slice(legacyPrefix[0].length),
      attribution: "automation",
      scheduledTaskId: legacyTaskId === undefined ? undefined : ScheduledTaskId.make(legacyTaskId),
    };
  }
  return {
    text: message.text,
    attribution:
      message.createdBy !== "agent"
        ? null
        : message.creationSource === "server"
          ? "t3code"
          : "agent",
    scheduledTaskId: undefined,
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
