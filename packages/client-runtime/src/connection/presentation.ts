import type { ServerConfig } from "@t3tools/contracts";
import * as Option from "effect/Option";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  RelayConnectionTarget,
  SshConnectionTarget,
  type ConnectionTarget,
  type SupervisorConnectionState,
} from "./model.ts";

export type EnvironmentConnectionPhase =
  | "available"
  | "offline"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error"
  | "unsupported";

export interface EnvironmentConnectionPresentation {
  readonly phase: EnvironmentConnectionPhase;
  readonly error: string | null;
  readonly traceId: string | null;
}

export interface EnvironmentPresentation {
  readonly entry: ConnectionCatalogEntry;
  readonly connection: EnvironmentConnectionPresentation;
  readonly serverConfig: ServerConfig | null;
}

export function presentConnectionState(
  state: SupervisorConnectionState,
): EnvironmentConnectionPresentation {
  switch (state.phase) {
    case "available":
      return { phase: "available", error: null, traceId: null };
    case "offline":
      return { phase: "offline", error: null, traceId: null };
    case "connecting":
      return {
        phase: state.attempt <= 1 && state.lastFailure === null ? "connecting" : "reconnecting",
        error: state.lastFailure?.message ?? null,
        traceId: state.lastFailure?.traceId ?? null,
      };
    case "connected":
      return { phase: "connected", error: null, traceId: null };
    case "backoff":
      return {
        phase: "reconnecting",
        error: state.lastFailure?.message ?? null,
        traceId: state.lastFailure?.traceId ?? null,
      };
    case "blocked":
      return {
        phase: state.lastFailure?.reason === "unsupported" ? "unsupported" : "error",
        error: state.lastFailure?.message ?? null,
        traceId: state.lastFailure?.traceId ?? null,
      };
  }
}

export function connectionStatusText(connection: EnvironmentConnectionPresentation): string {
  switch (connection.phase) {
    case "available":
      return "Available";
    case "offline":
      return "Offline";
    case "connecting":
      return "Connecting...";
    case "reconnecting":
      return connection.error
        ? `Failed to connect. Reconnecting... Reason: ${connection.error}`
        : "Reconnecting...";
    case "connected":
      return "Connected";
    case "unsupported":
      return "Client not supported";
    case "error":
      return connection.error
        ? `Connection failed. Reason: ${connection.error}`
        : "Connection failed";
  }
}

export function connectionStatusTitle(connection: EnvironmentConnectionPresentation): string {
  if (connection.phase === "reconnecting" && connection.error) {
    return "Failed to connect. Reconnecting...";
  }
  return connectionStatusText({ ...connection, error: null });
}

export function presentEnvironmentConnection(
  state: SupervisorConnectionState,
): EnvironmentConnectionPresentation {
  return presentConnectionState(state);
}

export function connectionCatalogDisplayUrl(entry: ConnectionCatalogEntry): string | null {
  switch (entry.target._tag) {
    case "PrimaryConnectionTarget":
      return entry.target.httpBaseUrl;
    case "RelayConnectionTarget":
      return null;
    case "BearerConnectionTarget":
      return Option.isSome(entry.profile) && entry.profile.value._tag === "BearerConnectionProfile"
        ? entry.profile.value.httpBaseUrl
        : null;
    case "SshConnectionTarget":
      return Option.isSome(entry.profile) && entry.profile.value._tag === "SshConnectionProfile"
        ? `${entry.profile.value.target.username}@${entry.profile.value.target.hostname}`
        : null;
  }
}

/**
 * The name to show for a saved environment.
 *
 * The label saved at registration never refreshes, so it goes stale when the
 * host is renamed, and a T3 Connect record without a label carries the
 * environment id instead. The server's live descriptor label (from its config,
 * which is cached across restarts) is therefore the source of truth, except
 * when the saved label was chosen on purpose (`labelOverride`).
 */
export function resolveEnvironmentDisplayLabel(
  target: ConnectionTarget,
  serverConfig: Pick<ServerConfig, "environment"> | null,
): string {
  if (target.labelOverride === true) {
    return target.label;
  }
  // Defensive reads: cached configs are decoded loosely and may predate fields.
  const environment = serverConfig?.environment;
  const descriptorLabel = typeof environment?.label === "string" ? environment.label.trim() : "";
  if (descriptorLabel !== "" && environment?.environmentId === target.environmentId) {
    return descriptorLabel;
  }
  return target.label;
}

function withTargetLabel(target: ConnectionTarget, label: string): ConnectionTarget {
  switch (target._tag) {
    case "PrimaryConnectionTarget":
      return new PrimaryConnectionTarget({
        environmentId: target.environmentId,
        label,
        httpBaseUrl: target.httpBaseUrl,
        wsBaseUrl: target.wsBaseUrl,
      });
    case "BearerConnectionTarget":
      return new BearerConnectionTarget({
        environmentId: target.environmentId,
        label,
        connectionId: target.connectionId,
      });
    case "RelayConnectionTarget":
      return new RelayConnectionTarget({ environmentId: target.environmentId, label });
    case "SshConnectionTarget":
      return new SshConnectionTarget({
        environmentId: target.environmentId,
        label,
        connectionId: target.connectionId,
      });
  }
}

/**
 * The catalog entry as presentation shows it: `target.label` is the display
 * label from {@link resolveEnvironmentDisplayLabel}. Returns the same entry when
 * nothing changes, so reference equality keeps holding.
 */
export function presentCatalogEntry(
  entry: ConnectionCatalogEntry,
  serverConfig: Pick<ServerConfig, "environment"> | null,
): ConnectionCatalogEntry {
  const label = resolveEnvironmentDisplayLabel(entry.target, serverConfig);
  return label === entry.target.label
    ? entry
    : { ...entry, target: withTargetLabel(entry.target, label) };
}
