/**
 * The code profile this client is locked to, if any. Set once at startup by
 * the app (web keeps it per browser profile / desktop app), before any
 * environment connects. Every socket and orchestration HTTP request carries
 * it, and the server then answers with only that profile's projects plus the
 * common ones. Changing it takes a reload, since open streams keep the lock
 * they connected with.
 */
let clientProfileLock: string | null = null;

export function setClientProfileLock(profile: string | null): void {
  const trimmed = profile?.trim() ?? "";
  clientProfileLock = trimmed === "" ? null : trimmed;
}

export function getClientProfileLock(): string | null {
  return clientProfileLock;
}
