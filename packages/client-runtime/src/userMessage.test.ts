import { ScheduledTaskId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatComponentAnswer,
  normalizeComponentQuestion,
  parseComponentAnswer,
  resolveUserMessagePresentation,
} from "./userMessage.ts";

describe("resolveUserMessagePresentation", () => {
  const legacyText = "[Triggered by schedule task: Daily audit]\n\nCheck for crashes.\n";

  it("removes attribution from legacy scheduled prompts", () => {
    expect(
      resolveUserMessagePresentation({ role: "user", createdBy: "agent", text: legacyText }),
    ).toEqual({ text: "Check for crashes.\n", isAutomation: true, scheduledTaskId: undefined });
  });

  it("uses task metadata without changing the prompt", () => {
    expect(
      resolveUserMessagePresentation({
        role: "user",
        createdBy: "agent",
        scheduledTaskId: ScheduledTaskId.make("task-1"),
        text: legacyText,
      }),
    ).toEqual({ text: legacyText, isAutomation: true, scheduledTaskId: "task-1" });
  });

  it("preserves user-written and assistant-quoted schedule headers", () => {
    for (const message of [
      { role: "user", createdBy: "user" as const },
      { role: "user" },
      { role: "assistant", createdBy: "agent" as const },
    ]) {
      expect(resolveUserMessagePresentation({ ...message, text: legacyText })).toEqual({
        text: legacyText,
        isAutomation: false,
        scheduledTaskId: undefined,
      });
    }
  });

  it("leaves other agent prompts and embedded headers intact", () => {
    for (const text of [
      "Review this area",
      `Quoted prompt:\n${legacyText}`,
      "[Triggered by schedule task: Daily audit]",
    ]) {
      expect(resolveUserMessagePresentation({ role: "user", createdBy: "agent", text })).toEqual({
        text,
        isAutomation: false,
        scheduledTaskId: undefined,
      });
    }
  });

  it("recovers the triggering automation from older scheduler message ids", () => {
    for (const trigger of ["scheduled", "manual"]) {
      expect(
        resolveUserMessagePresentation({
          id: `scheduled-task-message:task:daily-audit:1788661140000:${trigger}`,
          role: "user",
          createdBy: "user",
          text: legacyText,
        }),
      ).toEqual({
        text: "Check for crashes.\n",
        isAutomation: true,
        scheduledTaskId: "task:daily-audit",
      });
    }
  });
});

describe("component answers", () => {
  it("round-trips a question and its answer", () => {
    const text = formatComponentAnswer("Which game next?", "Both are boring.\nSkip them.");
    expect(text).toBe('[Answer to: "Which game next?"] Both are boring.\nSkip them.');
    expect(parseComponentAnswer(text)).toEqual({
      question: "Which game next?",
      answer: "Both are boring.\nSkip them.",
    });
  });

  it("keeps the question on one line the parser can read back", () => {
    const question = 'Ship "it"?\n  Now';
    const parsed = parseComponentAnswer(formatComponentAnswer(question, "Yes"));
    expect(parsed).toEqual({ question: "Ship 'it'? Now", answer: "Yes" });
    expect(normalizeComponentQuestion(question)).toBe(parsed?.question);
    expect(normalizeComponentQuestion("x".repeat(400))).toHaveLength(160);
  });

  it("sends a bare answer when the component has no question", () => {
    expect(formatComponentAnswer("  ", "Yes")).toBe("Yes");
  });

  it("leaves ordinary messages alone", () => {
    expect(parseComponentAnswer("Answer to: nothing")).toBeNull();
    expect(parseComponentAnswer('[Answer to: "q"] ')).toBeNull();
  });
});
