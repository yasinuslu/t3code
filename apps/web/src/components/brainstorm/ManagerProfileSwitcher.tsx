/**
 * Switches between the code profiles' managers, and with them the profile in
 * view (the active space). Shown on Home and on a manager's own thread page;
 * renders nothing with fewer than two profiles.
 */
import { useBrainstormStore, useManagerProfile } from "../../brainstormStore";
import { ALL_SPACE_ID, useSpaceStore } from "../../spaceStore";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

/** Toggle value for All; profile names never contain a colon. */
const ALL_VALUE = ":all";

export function ManagerProfileSwitcher(props: {
  /** Offer All too: every profile's work on Home, keeping the current manager. */
  readonly includeAll?: boolean;
  readonly onSelect: (profile: string | null) => void;
  readonly className?: string;
}) {
  const profiles = useBrainstormStore((state) => state.profiles);
  const managerProfile = useManagerProfile();
  const allActive = useSpaceStore((store) => store.activeSpaceId === ALL_SPACE_ID);
  if (profiles === null || profiles.length < 2) return null;
  const value = props.includeAll && allActive ? ALL_VALUE : managerProfile;
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
        props.onSelect(picked === ALL_VALUE ? null : picked);
      }}
    >
      {profiles.map((profile) => (
        <Toggle key={profile} value={profile} aria-label={`${profile} manager`}>
          {profile}
        </Toggle>
      ))}
      {props.includeAll ? (
        <Toggle value={ALL_VALUE} aria-label="Every profile's work">
          All
        </Toggle>
      ) : null}
    </ToggleGroup>
  );
}
