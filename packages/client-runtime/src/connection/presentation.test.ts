import { EnvironmentId, type ServerConfig } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import {
  BearerConnectionTarget,
  ConnectionTransientError,
  RelayConnectionTarget,
  type SupervisorConnectionState,
} from "./model.ts";
import {
  environmentMcpUrl,
  presentCatalogEntry,
  presentEnvironmentConnection,
  resolveEnvironmentDisplayLabel,
  presentConnectionState,
} from "./presentation.ts";

const TARGET = new BearerConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Remote environment",
  connectionId: "connection-1",
});

const ENTRY: ConnectionCatalogEntry = {
  target: TARGET,
  profile: Option.some(
    new BearerConnectionProfile({
      connectionId: TARGET.connectionId,
      environmentId: TARGET.environmentId,
      label: TARGET.label,
      httpBaseUrl: "https://environment.example.test",
      wsBaseUrl: "wss://environment.example.test",
    }),
  ),
  enabled: true,
};

function supervisorState(overrides: Partial<SupervisorConnectionState>): SupervisorConnectionState {
  return {
    desired: true,
    network: "online",
    phase: "connecting",
    stage: "preparing",
    attempt: 1,
    generation: 0,
    lastFailure: null,
    retryAt: null,
    ...overrides,
  };
}

describe("connection presentation", () => {
  it("copies the MCP address of the route this device is connected over", () => {
    const route = (connectionId: string, httpBaseUrl: string): ConnectionRoute => {
      const target = new BearerConnectionTarget({ ...TARGET, connectionId });
      return {
        target,
        profile: Option.some(
          new BearerConnectionProfile({
            connectionId,
            environmentId: TARGET.environmentId,
            label: TARGET.label,
            httpBaseUrl,
            wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
          }),
        ),
      };
    };
    const lan = route("lan", "http://192.168.4.53:3773/");
    const tailnet = route("tailnet", "http://100.115.1.44:3773/");
    const serve = route("serve", "https://machine.tailnet.ts.net/");
    const entry: ConnectionCatalogEntry = {
      ...ENTRY,
      target: lan.target,
      profile: lan.profile,
      alternateRoutes: [tailnet, serve],
    };

    expect(environmentMcpUrl({ entry, connectedTarget: tailnet.target })).toBe(
      "http://100.115.1.44:3773/mcp",
    );
    expect(environmentMcpUrl({ entry })).toBe("http://192.168.4.53:3773/mcp");
  });

  // regression: #16909 Copy MCP URL falls back to an alternate route when the relay route has no address
  it("passes over routes without an address of their own", () => {
    const relay = new RelayConnectionTarget({
      environmentId: TARGET.environmentId,
      label: TARGET.label,
    });
    const entry: ConnectionCatalogEntry = {
      ...ENTRY,
      target: relay,
      profile: Option.none(),
      alternateRoutes: [{ target: ENTRY.target, profile: ENTRY.profile }],
    };

    expect(environmentMcpUrl({ entry, connectedTarget: relay })).toBe(
      "https://environment.example.test/mcp",
    );
    expect(
      environmentMcpUrl({
        entry,
        connectedTarget: relay,
        relayHttpBaseUrl: "https://tunnel.example.test",
      }),
    ).toBe("https://tunnel.example.test/mcp");
  });

  it("distinguishes initial connection, reconnect, and retry errors", () => {
    expect(presentConnectionState(supervisorState({ phase: "connecting", attempt: 1 }))).toEqual({
      phase: "connecting",
      error: null,
      traceId: null,
    });
    expect(
      presentConnectionState(
        supervisorState({
          phase: "connecting",
          attempt: 2,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Socket closed.",
            traceId: "trace-previous",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      error: "Socket closed.",
      traceId: "trace-previous",
    });
    expect(
      presentConnectionState(
        supervisorState({
          phase: "backoff",
          attempt: 2,
          retryAt: 1,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Disconnected.",
            traceId: "trace-1",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      error: "Disconnected.",
      traceId: "trace-1",
    });
  });

  it("preserves an explicitly available environment while offline", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          desired: false,
          network: "offline",
          phase: "available",
          stage: null,
          attempt: 0,
        }),
      ),
    ).toEqual({
      phase: "available",
      error: null,
      traceId: null,
    });
  });
});

function descriptorConfig(environmentId: EnvironmentId, label: string) {
  return { environment: { environmentId, label } } as unknown as ServerConfig;
}

describe("environment display label", () => {
  const relayEnvironmentId = EnvironmentId.make("f5de33b4-1d88-452a-a72f-b3b1d5b68228");

  it("prefers the live descriptor label over a stale saved one", () => {
    expect(
      resolveEnvironmentDisplayLabel(TARGET, descriptorConfig(TARGET.environmentId, "tenriyo")),
    ).toBe("tenriyo");
  });

  it("replaces a relay label that fell back to the environment id", () => {
    const target = new RelayConnectionTarget({
      environmentId: relayEnvironmentId,
      label: relayEnvironmentId,
    });
    expect(resolveEnvironmentDisplayLabel(target, null)).toBe(relayEnvironmentId);
    expect(
      resolveEnvironmentDisplayLabel(target, descriptorConfig(relayEnvironmentId, "  tenriyo  ")),
    ).toBe("tenriyo");
  });

  it("keeps a deliberately chosen label", () => {
    const target = new BearerConnectionTarget({
      environmentId: TARGET.environmentId,
      label: "WSL: Ubuntu",
      connectionId: "local:wsl-ubuntu",
      labelOverride: true,
    });
    expect(
      resolveEnvironmentDisplayLabel(target, descriptorConfig(TARGET.environmentId, "DESKTOP-1")),
    ).toBe("WSL: Ubuntu");
  });

  it("keeps the saved label without a usable descriptor", () => {
    expect(resolveEnvironmentDisplayLabel(TARGET, null)).toBe(TARGET.label);
    expect(
      resolveEnvironmentDisplayLabel(TARGET, descriptorConfig(TARGET.environmentId, "   ")),
    ).toBe(TARGET.label);
    expect(
      resolveEnvironmentDisplayLabel(
        TARGET,
        descriptorConfig(EnvironmentId.make("someone-else"), "other"),
      ),
    ).toBe(TARGET.label);
  });

  it("presents the entry with the display label and keeps it stable when unchanged", () => {
    expect(presentCatalogEntry(ENTRY, null)).toBe(ENTRY);
    expect(presentCatalogEntry(ENTRY, descriptorConfig(TARGET.environmentId, TARGET.label))).toBe(
      ENTRY,
    );
    const presented = presentCatalogEntry(ENTRY, descriptorConfig(TARGET.environmentId, "tenriyo"));
    expect(presented.target).toBeInstanceOf(BearerConnectionTarget);
    expect(presented.target).toMatchObject({
      _tag: "BearerConnectionTarget",
      environmentId: TARGET.environmentId,
      label: "tenriyo",
      connectionId: TARGET.connectionId,
    });
    expect(presented.profile).toBe(ENTRY.profile);
    expect(presented.enabled).toBe(true);
  });
});
