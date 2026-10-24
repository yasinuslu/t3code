/**
 * One `<t3-*>` component inside an assistant message. Whatever the model wrote, the message
 * still reads: an unknown tag shows its text under a chip, bad props show an error card with the
 * raw content, a half-streamed body waits, and a component that throws draws its own error card
 * (the library's base class) or is caught here. Interactive components talk back through
 * `t3-send`, which becomes the user's next message on the thread.
 */
import { formatComponentAnswer, parseComponentAnswer } from "@t3tools/client-runtime/user-message";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { BlocksIcon, CheckIcon, TriangleAlertIcon } from "lucide-react";
import {
  Component,
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn, newMessageId } from "../lib/utils";
import { readThreadShell, useThreadProjection } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { toastManager } from "../components/ui/toast";
import { elementProps } from "@t3tools/shared/elementProps";

import { elementPlainText, elementQuestion } from "./elementProps";
import { useElementsLibrary } from "./library";
import { PortalHost } from "./PortalHost";
import { type PortalRequest, parsePortalRequest } from "./portalLogic";

/**
 * Where a component answers when it is not inside a thread's messages (a Grow page). It gets the
 * reply text, already carrying its question, and sends it the way that surface sends replies.
 */
export const ElementAnswerContext = createContext<((text: string) => void) | null>(null);

interface ElementSlotProps {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly body: string;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly streaming: boolean;
}

export function ElementSlot(props: ElementSlotProps) {
  return (
    <SlotBoundary tag={props.tag} body={props.body}>
      <ElementSlotInner {...props} />
    </SlotBoundary>
  );
}

function ElementSlotInner(props: ElementSlotProps) {
  const library = useElementsLibrary(props.environmentId, props.tag);
  const manifest = library?.components.get(props.tag);
  const result = useMemo(
    () =>
      manifest === undefined
        ? null
        : elementProps({
            manifest,
            attributes: props.attributes,
            body: props.body,
            streaming: props.streaming,
          }),
    [manifest, props.attributes, props.body, props.streaming],
  );

  if (library === null) return <Placeholder tag={props.tag} />;
  if (manifest === undefined || result === null) {
    return (
      <Fallback tag={props.tag} body={props.body} tone="muted">
        Unknown component
      </Fallback>
    );
  }
  if (result.kind === "pending") return <Placeholder tag={props.tag} />;
  if (result.kind === "invalid") {
    return (
      <Fallback tag={props.tag} body={props.body} tone="error" errors={result.errors}>
        Could not draw
      </Fallback>
    );
  }
  return (
    <LiveElement
      tag={props.tag}
      props={result.props}
      threadRef={props.threadRef}
      plainText={elementPlainText(props.body)}
      interactive={manifest.interactive === true}
    />
  );
}

/** Mounts the real custom element and wires its events to the thread. */
function LiveElement(props: {
  readonly tag: string;
  readonly props: Record<string, unknown>;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly plainText: string;
  readonly interactive: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const element = useRef<HTMLElement | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [portal, setPortal] = useState<PortalRequest | null>(null);
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const answerElsewhere = use(ElementAnswerContext);
  // The question travels with the answer, so the agent and the transcript both know what it
  // answers. The answer itself is remembered here to lock the component until the thread
  // projection (which is what survives a reload) catches up.
  const question = useMemo(() => elementQuestion(props.props), [props.props]);
  const [sentAnswer, setSentAnswer] = useState<string | null>(null);
  const threadAnswer = useThreadAnswer(props.interactive ? props.threadRef : undefined, question);
  const answer = sentAnswer ?? threadAnswer;
  const send = useEffectEvent((text: string) => {
    const threadRef = props.threadRef;
    const reply = formatComponentAnswer(question, text);
    if (answerElsewhere !== null && !threadRef) {
      setSentAnswer(text);
      answerElsewhere(reply);
      return;
    }
    const shell = threadRef ? readThreadShell(threadRef) : undefined;
    if (!threadRef || !shell) {
      toastManager.add({ type: "error", title: "This message cannot answer its thread" });
      return;
    }
    setSentAnswer(text);
    void startTurn({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        message: { messageId: newMessageId(), role: "user", text: reply, attachments: [] },
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
      },
    }).then((result) => {
      if (result._tag === "Failure") {
        setSentAnswer(null);
        toastManager.add({ type: "error", title: "Could not send the answer" });
      }
    });
  });

  const onSend = useEffectEvent((event: Event) => {
    const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
    if (typeof text === "string" && text.trim() !== "") send(text.trim().slice(0, 4000));
  });
  const onOpen = useEffectEvent((event: Event) => {
    const url = (event as CustomEvent<{ url?: unknown }>).detail?.url;
    if (typeof url === "string" && /^(https?:|data:image\/)/.test(url)) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  });
  // `t3-portal`: a component asks for a full screen view. Handling it (preventDefault) tells the
  // component not to fall back to its own overlay.
  const onPortal = useEffectEvent((event: Event) => {
    const request = parsePortalRequest(
      (event as CustomEvent).detail,
      (tag) => customElements.get(tag) !== undefined,
    );
    if (request === null) return;
    event.preventDefault();
    setPortal(request);
  });
  const closePortal = useCallback(() => setPortal(null), []);

  // One element per tag for the slot's life; new props are set on it, so it keeps its state.
  useEffect(() => {
    const container = host.current;
    if (container === null) return;
    let created: HTMLElement;
    try {
      created = document.createElement(props.tag);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return;
    }
    created.addEventListener("t3-send", onSend);
    created.addEventListener("t3-open", onOpen);
    created.addEventListener("t3-portal", onPortal);
    container.replaceChildren(created);
    element.current = created;
    return () => {
      created.removeEventListener("t3-send", onSend);
      created.removeEventListener("t3-open", onOpen);
      created.removeEventListener("t3-portal", onPortal);
      created.remove();
      element.current = null;
    };
  }, [props.tag]);

  useEffect(() => {
    const current = element.current as (HTMLElement & Record<string, unknown>) | null;
    if (current === null) return;
    try {
      current.props = props.props;
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }, [props.props]);

  // An answered component stays on screen but takes no second answer.
  const answered = answer !== null;
  useEffect(() => {
    const current = element.current as (HTMLElement & Record<string, unknown>) | null;
    if (current !== null) current.readOnly = answered;
  }, [answered]);

  if (failure !== null) {
    return (
      <Fallback tag={props.tag} body={props.plainText} tone="error" errors={[failure]}>
        Could not draw
      </Fallback>
    );
  }
  return (
    <span
      className="t3-element-host my-3 block"
      data-t3-live={props.tag}
      data-t3-question={question === "" ? undefined : question}
    >
      {/* Dimmed and inert once answered, so it no longer looks open. */}
      <span
        ref={host}
        className={cn("block", answered && "pointer-events-none opacity-60")}
        aria-disabled={answered || undefined}
      />
      {answer !== null ? (
        <span
          className="mt-1.5 flex min-w-0 items-center gap-1.5 px-1 text-foreground/80 text-xs"
          data-t3-answered
        >
          <CheckIcon className="size-3.5 shrink-0 text-success" aria-hidden />
          <span className="shrink-0">Answered</span>
          <span className="min-w-0 truncate text-foreground">{answer}</span>
        </span>
      ) : null}
      {portal !== null ? (
        <PortalHost
          request={portal}
          onClose={closePortal}
          onSend={(event) => {
            onSend(event);
            closePortal();
          }}
          onOpen={(event) => onOpen(event)}
        />
      ) : null}
      {/* Copy and screen readers get the component's words, not its shadow DOM. */}
      <span className="sr-only">{props.plainText}</span>
    </span>
  );
}

/**
 * The answer this thread already holds for the component asking `question`, or null. Only
 * interactive components ask (`threadRef` stays undefined for the rest), so a streaming thread
 * does not re-render every component. Two components with the same question share an answer.
 */
function useThreadAnswer(threadRef: ScopedThreadRef | undefined, question: string): string | null {
  const projection = useThreadProjection(threadRef ?? null)?.projection;
  return useMemo(() => {
    if (question === "" || !projection) return null;
    for (let index = projection.messages.length - 1; index >= 0; index -= 1) {
      const message = projection.messages[index];
      if (message?.role !== "user") continue;
      const parsed = parseComponentAnswer(message.text);
      if (parsed?.question === question) return parsed.answer;
    }
    return null;
  }, [projection, question]);
}

function Placeholder(props: { readonly tag: string }) {
  return (
    <span
      className="my-3 flex h-16 items-center gap-2 rounded-xl border border-dashed px-4 text-muted-foreground text-xs"
      data-t3-pending={props.tag}
    >
      <BlocksIcon className="size-3.5" aria-hidden />
      {props.tag}…
    </span>
  );
}

function Fallback(props: {
  readonly tag: string;
  readonly body: string;
  readonly tone: "muted" | "error";
  readonly errors?: ReadonlyArray<string>;
  readonly children: ReactNode;
}) {
  const text = props.body.trim();
  return (
    <span
      className={cn(
        "my-3 block rounded-xl border px-3 py-2.5",
        props.tone === "error" ? "border-destructive/30 bg-destructive/5" : "border-dashed",
      )}
      data-t3-fallback={props.tag}
    >
      <span className="flex flex-wrap items-center gap-1.5 text-xs">
        {props.tone === "error" ? (
          <TriangleAlertIcon className="size-3.5 text-destructive" aria-hidden />
        ) : (
          <BlocksIcon className="size-3.5 text-muted-foreground" aria-hidden />
        )}
        <span className="font-medium text-foreground">{props.children}</span>
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-2xs">{`<${props.tag}>`}</code>
      </span>
      {props.errors?.length ? (
        <span className="mt-1 block text-destructive text-xs">{props.errors.join(" ")}</span>
      ) : null}
      {text !== "" ? (
        <span className="mt-1.5 block whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs">
          {text}
        </span>
      ) : null}
    </span>
  );
}

class SlotBoundary extends Component<
  { readonly tag: string; readonly body: string; readonly children: ReactNode },
  { readonly error: Error | null }
> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <Fallback
        tag={this.props.tag}
        body={this.props.body}
        tone="error"
        errors={[this.state.error.message]}
      >
        Could not draw
      </Fallback>
    );
  }
}
