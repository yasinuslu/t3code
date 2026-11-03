import { describe, expect, it } from "vite-plus/test";

import { profileMismatch, profileMismatchMessage } from "./profileGuard.ts";

describe("profileMismatch", () => {
  it("flags an instance of another profile", () => {
    expect(profileMismatch("yu", "sn")).toEqual({ instanceProfile: "yu", workspaceProfile: "sn" });
    expect(profileMismatch("sn", "yu")).toEqual({ instanceProfile: "sn", workspaceProfile: "yu" });
  });

  it("lets the same profile, common projects and unknown sides through", () => {
    expect(profileMismatch("sn", "sn")).toBe(undefined);
    expect(profileMismatch("yu", "common")).toBe(undefined);
    expect(profileMismatch("common", "sn")).toBe(undefined);
    expect(profileMismatch(undefined, "sn")).toBe(undefined);
    expect(profileMismatch("yu", null)).toBe(undefined);
  });

  it("names both profiles in the refusal", () => {
    const message = profileMismatchMessage(
      { instanceProfile: "yu", workspaceProfile: "sn" },
      "Claude YU",
    );
    expect(message).toContain('"Claude YU" runs from the yu profile');
    expect(message).toContain("Pick a sn instance");
  });
});
