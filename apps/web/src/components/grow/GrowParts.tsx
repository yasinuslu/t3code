import { GROW_STAGES } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { growEnvironment } from "../../state/grow";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { GROW_STAGE_DEFS, type GrowBoardCard, type GrowPatch } from "./grow.logic";

const AUTOMATIC = "automatic";

/** Resolves true once the change is recorded. */
export type UpdateCard = (card: GrowBoardCard, patch: GrowPatch) => Promise<boolean>;

/** Records a change on a thread's card. */
export function useGrowUpdate(): UpdateCard {
  const run = useAtomCommand(growEnvironment.update);
  return async (card, patch) => {
    const result = await run({
      environmentId: card.thread.environmentId,
      input: { threadId: card.thread.id, ...patch },
    });
    return result._tag === "Success";
  };
}

/**
 * A text field that saves when focus leaves it. It follows the stored value
 * (an agent may change it) except while the user is typing in it.
 */
export function SavedField(props: {
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onSave: (value: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(props.value);
  const [editing, setEditing] = useState(false);
  const [seen, setSeen] = useState(props.value);
  // "Saved" shows for a couple of seconds after a successful save.
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );
  if (props.value !== seen && !editing) {
    setSeen(props.value);
    setDraft(props.value);
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-baseline gap-2 font-medium text-xs">
        {props.label}
        {saved ? (
          <span role="status" className="font-normal text-muted-foreground">
            Saved
          </span>
        ) : null}
      </span>
      <Textarea
        aria-label={props.label}
        placeholder={props.placeholder}
        value={draft}
        onFocus={() => setEditing(true)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() === props.value.trim()) return;
          void props.onSave(draft).then((ok) => {
            if (!ok) return;
            setSaved(true);
            if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
            savedTimer.current = window.setTimeout(() => setSaved(false), 2500);
          });
        }}
      />
    </div>
  );
}

/** The stage's actions from `GROW_STAGE_DEFS`, plus the manual escape hatch. */
export function StageActions(props: { readonly card: GrowBoardCard; readonly update: UpdateCard }) {
  const { card, update } = props;
  const stored = card.card?.stage ?? AUTOMATIC;
  const nowTitle = GROW_STAGE_DEFS[card.stage].title;
  const items = [
    { value: AUTOMATIC, label: `Automatic (now: ${nowTitle})` },
    ...GROW_STAGES.map((stage) => ({ value: stage, label: GROW_STAGE_DEFS[stage].title })),
  ];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {GROW_STAGE_DEFS[card.stage].actions.map((action) => (
        <Button
          key={action.label}
          size="sm"
          variant={action.primary ? "default" : "outline"}
          onClick={() => void update(card, action.patch)}
        >
          {action.label}
        </Button>
      ))}
      <span className="ms-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground text-xs">
        Move to
        <Select
          items={items}
          value={stored}
          onValueChange={(value) => {
            const stage = GROW_STAGES.find((candidate) => candidate === value);
            void update(card, { stage: stage ?? null });
          }}
        >
          <SelectTrigger size="compact" aria-label="Move to">
            {/* The stage the card is in, whether chosen or automatic. */}
            <SelectValue>{() => nowTitle}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </span>
    </div>
  );
}
