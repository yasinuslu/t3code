import { describe, expect, it } from "vite-plus/test";

import { parseStagedBuild } from "./stagedBuild.ts";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnStagedBuild,
} from "./updateMachine.ts";

const runtimeInfo = {
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
} as const;
const checkedAt = "2026-10-18T00:00:00.000Z";
const idle = {
  ...createInitialDesktopUpdateState("1.0.0", runtimeInfo, "latest"),
  enabled: true,
  status: "idle" as const,
};

describe("staged builds", () => {
  it("reads a staged build and ignores missing or malformed files", () => {
    expect(parseStagedBuild('{"status":"ready","version":"1.0.1"}')).toEqual({
      status: "ready",
      version: "1.0.1",
    });
    expect(parseStagedBuild(null)).toBeNull();
    expect(parseStagedBuild("")).toBeNull();
    expect(parseStagedBuild("{not json")).toBeNull();
    expect(parseStagedBuild('{"status":"done","version":"1.0.1"}')).toBeNull();
  });

  it("shows a preparing build as downloading, then as ready to install", () => {
    const preparing = reduceDesktopUpdateStateOnStagedBuild(
      idle,
      { status: "preparing", version: "1.0.1" },
      checkedAt,
    );
    expect(preparing.status).toBe("downloading");
    expect(preparing.downloadedVersion).toBeNull();

    const ready = reduceDesktopUpdateStateOnStagedBuild(
      preparing,
      { status: "ready", version: "1.0.1" },
      checkedAt,
    );
    expect(ready.status).toBe("downloaded");
    expect(ready.downloadedVersion).toBe("1.0.1");

    const live = reduceDesktopUpdateStateOnStagedBuild(ready, null, checkedAt);
    expect(live.status).toBe("up-to-date");
    expect(live.downloadedVersion).toBeNull();
  });

  it("keeps a failed switch visible until another build is staged", () => {
    const ready = reduceDesktopUpdateStateOnStagedBuild(
      idle,
      { status: "ready", version: "1.0.1" },
      checkedAt,
    );
    const failed = reduceDesktopUpdateStateOnInstallFailure(ready, "exit 1");
    const polled = reduceDesktopUpdateStateOnStagedBuild(
      failed,
      { status: "ready", version: "1.0.1" },
      checkedAt,
    );
    expect(polled.errorContext).toBe("install");
    expect(polled.message).toBe("exit 1");

    const next = reduceDesktopUpdateStateOnStagedBuild(
      polled,
      { status: "ready", version: "1.0.2" },
      checkedAt,
    );
    expect(next.errorContext).toBeNull();
  });
});
