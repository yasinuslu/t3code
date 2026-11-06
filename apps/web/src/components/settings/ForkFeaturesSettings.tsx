import { type ForkFeature, isForkFeatureOn } from "@t3tools/contracts";

import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { type SettingsSearchItemId, searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const FORK_FEATURE_ROWS: ReadonlyArray<{
  readonly feature: ForkFeature;
  readonly searchId: SettingsSearchItemId;
  readonly description: string;
}> = [
  {
    feature: "manager",
    searchId: "fork-feature-manager",
    description:
      "The Manager chat: its sidebar entry, Ctrl+E, the command palette action and its tools.",
  },
  {
    feature: "codeProfiles",
    searchId: "fork-feature-code-profiles",
    description:
      "Folder-based code profiles: a Claude config dir per profile, profile lock, profile windows and the profile switch.",
  },
  {
    feature: "spaces",
    searchId: "fork-feature-spaces",
    description:
      "Sidebar spaces: the space switcher, space badges, and filtering the list by space.",
  },
  {
    feature: "accountBalancing",
    searchId: "fork-feature-account-balancing",
    description:
      "Auto balance in the model picker, and moving a thread to another account when one hits a usage limit.",
  },
  {
    feature: "webComponents",
    searchId: "fork-feature-web-components",
    description:
      "Inline t3-* components in chat, the render_component tool and its agent guidance.",
  },
  {
    feature: "previews",
    searchId: "fork-feature-previews",
    description:
      "Preview links and preview environments: the chips on threads and their agent tools.",
  },
  {
    feature: "presentation",
    searchId: "fork-feature-presentation",
    description: "The thread presentation in the right panel and the presentation_* agent tools.",
  },
  {
    feature: "keybindings",
    searchId: "fork-feature-keybindings",
    description:
      "Extra keyboard handling: pane movement (Ctrl+H/L), the shortcuts sheet and the desktop shell chords.",
  },
  {
    feature: "peers",
    searchId: "fork-feature-peers",
    description: "Peer environment tools that let agents reach threads on your other machines.",
  },
];

/** One switch per fork feature; every switch off behaves like upstream T3 Code. */
export function ForkFeaturesSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsSection id="fork-features" title="Fork features">
      <p className="px-4 py-3 text-muted-foreground text-xs">
        Features this build adds on top of upstream T3 Code. Turn them all off and it behaves like
        upstream.
      </p>
      {FORK_FEATURE_ROWS.map((row) => (
        <SettingsRow
          key={row.feature}
          serverScoped
          {...searchableSetting(row.searchId)}
          settingKeys={["forkFeatures"]}
          description={row.description}
          control={
            <ScopedSwitch
              settingKeys={["forkFeatures"]}
              checked={isForkFeatureOn(settings, row.feature)}
              onCheckedChange={(checked) =>
                updateSettings({ forkFeatures: { [row.feature]: Boolean(checked) } })
              }
              aria-label={searchableSetting(row.searchId).title}
            />
          }
        />
      ))}
    </SettingsSection>
  );
}
