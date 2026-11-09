import { useForkFeature } from "../forkFeatures";
import { BrainstormHost } from "./brainstorm/BrainstormHost";
import { ManagerRoute } from "./brainstorm/ManagerRoute";
import { ManagerShortcuts } from "./brainstorm/ManagerShortcuts";
import { PaneShortcuts } from "./PaneShortcuts";
import { ProfileShortcuts } from "./ProfileShortcuts";
import { ShellShortcuts } from "./ShellShortcuts";
import { ShortcutsSheet } from "./ShortcutsSheet";

/** The fork's app-global hosts and shortcut handlers, each behind its feature flag. */
export function ForkAppShell() {
  const manager = useForkFeature("manager");
  const codeProfiles = useForkFeature("codeProfiles");
  const keybindings = useForkFeature("keybindings");
  return (
    <>
      {manager ? (
        <>
          <BrainstormHost />
          <ManagerRoute />
          <ManagerShortcuts />
        </>
      ) : null}
      {codeProfiles ? <ProfileShortcuts /> : null}
      {keybindings ? (
        <>
          <PaneShortcuts />
          <ShellShortcuts />
          <ShortcutsSheet />
        </>
      ) : null}
    </>
  );
}
