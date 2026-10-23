import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { profileLockNow } from "../../profileLock";
import { primaryServerConfigAtom } from "../../state/server";

/**
 * Desktop only. Tells the shell which profile this window is locked to and
 * which code profiles the server knows, so the Window menu (Alt+Shift+1, Alt+Shift+2, ...)
 * can open one window per profile and focus the window already showing one.
 */
export function ProfileWindowReporter() {
  const config = useAtomValue(primaryServerConfigAtom);
  const profilesKey = config === null ? null : Object.keys(config.settings.codeProfiles).join("\n");
  useEffect(() => {
    const report = window.desktopBridge?.reportWindowProfile;
    if (!report || profilesKey === null) return;
    const profiles = profilesKey === "" ? [] : profilesKey.split("\n");
    void report({ lock: profileLockNow(), profiles }).catch(() => undefined);
  }, [profilesKey]);
  return null;
}
