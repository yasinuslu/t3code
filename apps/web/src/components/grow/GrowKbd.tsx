import type { GrowKeybindingCommand } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";

import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Kbd } from "../ui/kbd";

/** A Grow command's key as the live keybindings and this platform have it (Alt+E, ⌃E, ...). */
export function useGrowKeyLabel(command: GrowKeybindingCommand): string | null {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  return shortcutLabelForCommand(keybindings, command, { context: { growOpen: true } });
}

/** The hint beside a Grow button; nothing when the command has no key. */
export function GrowKbd(props: {
  readonly command: GrowKeybindingCommand;
  readonly className?: string;
}) {
  const label = useGrowKeyLabel(props.command);
  return label ? (
    <Kbd {...(props.className ? { className: props.className } : {})}>{label}</Kbd>
  ) : null;
}
