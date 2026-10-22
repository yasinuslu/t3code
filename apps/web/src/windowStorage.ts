/**
 * A window locked to one code profile with `?t3Window=<profile>` (the desktop
 * app opens one per profile) keeps its own copy of everything the app stores
 * in localStorage, so two windows side by side never change each other's
 * state. The lock lives in the window's URL and sessionStorage, which survive
 * reloads but belong to that window alone. Imported first by main.tsx, before
 * any store reads localStorage.
 */
export const WINDOW_PROFILE_URL_PARAM = "t3Window";
const SESSION_KEY = "t3code:window-profile";
const STORAGE_PREFIX = "t3code:window:";

function normalizeProfile(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" || trimmed.length > 64 ? null : trimmed;
}

function readWindowProfile(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromUrl = new URL(window.location.href).searchParams.get(WINDOW_PROFILE_URL_PARAM);
    if (fromUrl !== null) {
      const profile = normalizeProfile(fromUrl);
      if (profile === null) window.sessionStorage.removeItem(SESSION_KEY);
      else window.sessionStorage.setItem(SESSION_KEY, profile);
      return profile;
    }
    return normalizeProfile(window.sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

/** localStorage seen through a key prefix: one window's own slice of the shared store. */
export class PrefixedStorage implements Storage {
  constructor(
    private readonly base: Storage,
    private readonly prefix: string,
  ) {}

  private ownKeys(): string[] {
    const keys: string[] = [];
    for (let index = 0; index < this.base.length; index += 1) {
      const key = this.base.key(index);
      if (key?.startsWith(this.prefix)) keys.push(key.slice(this.prefix.length));
    }
    return keys;
  }

  get length(): number {
    return this.ownKeys().length;
  }

  key(index: number): string | null {
    return this.ownKeys()[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.base.getItem(this.prefix + key);
  }

  setItem(key: string, value: string): void {
    this.base.setItem(this.prefix + key, String(value));
  }

  removeItem(key: string): void {
    this.base.removeItem(this.prefix + key);
  }

  clear(): void {
    for (const key of this.ownKeys()) this.base.removeItem(this.prefix + key);
  }
}

/**
 * The first time a profile gets a window, its slice starts as a copy of the
 * app's own state (theme, layout, settings), then the two go separate ways.
 */
export function seedWindowStorage(base: Storage, profile: string): PrefixedStorage {
  const prefix = `${STORAGE_PREFIX}${profile}:`;
  const storage = new PrefixedStorage(base, prefix);
  const seededKey = `${STORAGE_PREFIX}seeded:${profile}`;
  if (base.getItem(seededKey) === null) {
    const shared: Array<readonly [string, string]> = [];
    for (let index = 0; index < base.length; index += 1) {
      const key = base.key(index);
      if (key === null || key.startsWith(STORAGE_PREFIX)) continue;
      const value = base.getItem(key);
      if (value !== null) shared.push([key, value]);
    }
    for (const [key, value] of shared) {
      if (storage.getItem(key) === null) storage.setItem(key, value);
    }
    base.setItem(seededKey, "1");
  }
  return storage;
}

function isolateLocalStorage(profile: string): void {
  try {
    const storage = seedWindowStorage(window.localStorage, profile);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      enumerable: true,
      get: () => storage,
    });
  } catch {
    // Without isolation the window still filters by profile; only UI state is shared.
  }
}

/** The profile this window is locked to, fixed for the life of the window. */
export const windowProfile = readWindowProfile();

if (windowProfile !== null) isolateLocalStorage(windowProfile);
