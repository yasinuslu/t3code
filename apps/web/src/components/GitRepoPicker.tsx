import type { VcsStatusSubmodule } from "@t3tools/contracts";
import { ChevronDownIcon, FolderGit2Icon } from "lucide-react";

import { Button } from "./ui/button";
import {
  Menu,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";

/** The radio value of the root repo; submodule paths are never empty. */
const ROOT_VALUE = "";

interface GitRepoPickerProps {
  /** `menu` nests the picker as a submenu of an enclosing menu. */
  readonly presentation?: "toolbar" | "menu";
  readonly rootLabel: string;
  readonly submodules: ReadonlyArray<VcsStatusSubmodule>;
  readonly selected: VcsStatusSubmodule | null;
  readonly onSelect: (path: string | null) => void;
  readonly disabled?: boolean;
}

/** Picks the repository git actions and diffs target: the root repo or one of its submodules. */
export function GitRepoPicker({
  presentation = "toolbar",
  rootLabel,
  submodules,
  selected,
  onSelect,
  disabled = false,
}: GitRepoPickerProps) {
  if (submodules.length === 0) return null;
  const selectedLabel = selected?.path ?? rootLabel;
  const options = (
    <MenuRadioGroup
      value={selected?.path ?? ROOT_VALUE}
      onValueChange={(next: string) => onSelect(next === ROOT_VALUE ? null : next)}
    >
      <MenuGroupLabel>Repository</MenuGroupLabel>
      <GitRepoOption value={ROOT_VALUE} label={rootLabel} hasChanges={false} />
      {submodules.map((submodule) => (
        <GitRepoOption
          key={submodule.path}
          value={submodule.path}
          label={submodule.path}
          hasChanges={submodule.hasChanges}
        />
      ))}
    </MenuRadioGroup>
  );

  if (presentation === "menu") {
    return (
      <MenuSub>
        <MenuSubTrigger density="touch" disabled={disabled}>
          <FolderGit2Icon className="size-4" />
          <span className="min-w-0 truncate">{selectedLabel}</span>
        </MenuSubTrigger>
        <MenuSubPopup>{options}</MenuSubPopup>
      </MenuSub>
    );
  }

  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="outline" size="xs" />}
        className="min-w-0 max-w-40 shrink"
        disabled={disabled}
        aria-label={`Git repository: ${selectedLabel}`}
      >
        <FolderGit2Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
      </MenuTrigger>
      <MenuPopup align="end">{options}</MenuPopup>
    </Menu>
  );
}

function GitRepoOption(props: {
  readonly value: string;
  readonly label: string;
  readonly hasChanges: boolean;
}) {
  return (
    <MenuRadioItem value={props.value} closeOnClick>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate">{props.label}</span>
        {props.hasChanges ? (
          <span
            role="img"
            aria-label="Has changes"
            className="size-1.5 shrink-0 rounded-full bg-warning"
          />
        ) : null}
        <MenuRadioItemIndicator />
      </span>
    </MenuRadioItem>
  );
}
