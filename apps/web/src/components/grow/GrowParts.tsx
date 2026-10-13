import { GROW_STAGES } from "@t3tools/contracts";
import { useState } from "react";

import { growEnvironment } from "../../state/grow";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { GROW_STAGE_DEFS, type GrowBoardCard, type GrowPatch } from "./grow.logic";

const AUTOMATIC = "automatic";

export type UpdateCard = (card: GrowBoardCard, patch: GrowPatch) => void;

/** Records a change on a thread's card. */
export function useGrowUpdate(): UpdateCard {
  const run = useAtomCommand(growEnvironment.update);
  return (card, patch) => {
    void run({
      environmentId: card.thread.environmentId,
      input: { threadId: card.thread.id, ...patch },
    });
  };
}

/**
 * A text field that saves when focus leaves it. It follows the stored value
 * (an agent may change it) except while the user is typing in it.
 */
export function SavedField(props: {
  readonly label: string;
  readonly value: string;
  readonly onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  const [editing, setEditing] = useState(false);
  const [seen, setSeen] = useState(props.value);
  if (props.value !== seen && !editing) {
    setSeen(props.value);
    setDraft(props.value);
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-xs">{props.label}</span>
      <Textarea
        aria-label={props.label}
        value={draft}
        onFocus={() => setEditing(true)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() !== props.value.trim()) props.onSave(draft);
        }}
      />
    </div>
  );
}

/** The stage's actions from `GROW_STAGE_DEFS`, plus the manual escape hatch. */
export function StageActions(props: { readonly card: GrowBoardCard; readonly update: UpdateCard }) {
  const { card, update } = props;
  const stored = card.card?.stage ?? AUTOMATIC;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {GROW_STAGE_DEFS[card.stage].actions.map((action) => (
        <Button
          key={action.label}
          size="sm"
          variant={action.primary ? "default" : "outline"}
          onClick={() => update(card, action.patch)}
        >
          {action.label}
        </Button>
      ))}
      <span className="ms-auto flex items-center gap-1.5 text-muted-foreground text-xs">
        Move to
        <Select
          value={stored}
          onValueChange={(value) => {
            const stage = GROW_STAGES.find((candidate) => candidate === value);
            update(card, { stage: stage ?? null });
          }}
        >
          <SelectTrigger size="compact" aria-label="Move to">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={AUTOMATIC}>Automatic</SelectItem>
            {GROW_STAGES.map((stage) => (
              <SelectItem key={stage} value={stage}>
                {GROW_STAGE_DEFS[stage].title}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </span>
    </div>
  );
}
