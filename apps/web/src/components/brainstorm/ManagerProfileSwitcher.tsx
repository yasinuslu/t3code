/**
 * Switches between the code profiles' managers, and with them the profile in
 * view (the active space). Shown on Home and on a manager's own thread page;
 * renders nothing with fewer than two profiles.
 */
import { useMouseThumbButtons } from "../../lib/mouseThumbButtons";
import { useBrainstormStore, useManagerProfile } from "../../brainstormStore";
import { ALL_SPACE_ID, useSpaceStore } from "../../spaceStore";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  MANAGER_PROFILE_ALL,
  adjacentManagerProfileChoice,
  managerProfileChoices,
} from "./brainstorm.logic";

/** The segments the switcher shows, in order, and the one that is active. */
function useManagerProfileChoice(includeAll: boolean) {
  const profiles = useBrainstormStore((state) => state.profiles);
  const managerProfile = useManagerProfile();
  const allActive = useSpaceStore((store) => store.activeSpaceId === ALL_SPACE_ID);
  return {
    choices: managerProfileChoices(profiles ?? [], includeAll),
    value: includeAll && allActive ? MANAGER_PROFILE_ALL : managerProfile,
  };
}

/**
 * Mouse thumb buttons step the switcher's selection while the pointer is
 * over `regionSelector`, like they step spaces over the sidebar. The same
 * `includeAll` and `onSelect` as the switcher on that page.
 */
export function useManagerProfileMouseButtons(props: {
  readonly regionSelector: string;
  readonly includeAll?: boolean;
  readonly onSelect: (profile: string | null) => void;
}) {
  const { choices, value } = useManagerProfileChoice(props.includeAll ?? false);
  useMouseThumbButtons(props.regionSelector, (direction) => {
    const next = adjacentManagerProfileChoice(choices, value, direction);
    if (next !== null) props.onSelect(next === MANAGER_PROFILE_ALL ? null : next);
  });
}

export function ManagerProfileSwitcher(props: {
  /** Offer All too: every profile's work on Home, keeping the current manager. */
  readonly includeAll?: boolean;
  readonly onSelect: (profile: string | null) => void;
  readonly className?: string;
}) {
  const profiles = useBrainstormStore((state) => state.profiles);
  const { value } = useManagerProfileChoice(props.includeAll ?? false);
  if (profiles === null || profiles.length < 2) return null;
  return (
    <ToggleGroup
      aria-label="Profile"
      data-manager-profile-switcher=""
      className={props.className}
      value={value === null ? [] : [value]}
      onValueChange={(next) => {
        const picked = next[0];
        // Pressing the active segment again keeps it.
        if (picked === undefined) return;
        props.onSelect(picked === MANAGER_PROFILE_ALL ? null : picked);
      }}
    >
      {profiles.map((profile) => (
        <Toggle key={profile} value={profile} aria-label={`${profile} manager`}>
          {profile}
        </Toggle>
      ))}
      {props.includeAll ? (
        <Toggle value={MANAGER_PROFILE_ALL} aria-label="Every profile's work">
          All
        </Toggle>
      ) : null}
    </ToggleGroup>
  );
}
