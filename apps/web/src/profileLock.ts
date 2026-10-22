/**
 * The code profile this app is locked to (see client-runtime's profileLock).
 * Kept in localStorage, so it is per desktop app and per browser profile, and
 * set from Settings or by opening the app once with `?t3Profile=<name>`
 * (`?t3Profile=` clears it). A locked app connects every environment with the
 * lock, so the servers send only that profile's and the common projects, and
 * it shows no space or manager-profile switcher.
 */
import { setClientProfileLock } from "@t3tools/client-runtime/profile-lock";

const STORAGE_KEY = "t3code:profile-lock";
export const PROFILE_LOCK_URL_PARAM = "t3Profile";

function readStorage(): string | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

function writeStorage(profile: string | null): void {
  try {
    if (profile === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, profile);
  } catch {
    // Storage can be unavailable (private mode); the lock then lasts this load.
  }
}

let currentLock: string | null = null;

/** Reads the lock (a `?t3Profile=` in the URL wins and is saved) before anything connects. */
export function applyStoredProfileLock(): string | null {
  let lock = readStorage();
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has(PROFILE_LOCK_URL_PARAM)) {
      const requested = url.searchParams.get(PROFILE_LOCK_URL_PARAM)?.trim() ?? "";
      lock = requested === "" ? null : requested;
      writeStorage(lock);
      url.searchParams.delete(PROFILE_LOCK_URL_PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  } catch {
    // Keep the stored lock.
  }
  currentLock = lock;
  setClientProfileLock(lock);
  return lock;
}

/** The lock this load connected with; fixed until the next reload. */
export function profileLockNow(): string | null {
  return currentLock;
}

/** Saves a new lock and reloads, since open connections keep the old one. */
export function changeProfileLock(profile: string | null): void {
  const next = profile?.trim() ? profile.trim() : null;
  if (next === currentLock) return;
  writeStorage(next);
  window.location.reload();
}
