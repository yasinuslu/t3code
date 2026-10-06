import { describe, expect, it } from "vite-plus/test";

import { profileWithActiveLogin, profileWithoutLogin } from "./CodeProfileSettings";

const profile = {
  root: "/home/dev/code/work",
  claude: {
    configDir: "/home/dev/code/work/.claude",
    extraConfigDirs: [],
    logins: [
      { id: "a1", name: "Billing" },
      { id: "b2", name: "Team" },
    ],
  },
};

describe("code profile logins", () => {
  it("switches the active login and back to home without touching the home dir", () => {
    const billed = profileWithActiveLogin(profile, "a1");
    expect(billed.claude).toMatchObject({ configDir: profile.claude.configDir, activeLogin: "a1" });
    const home = profileWithActiveLogin(billed, "home");
    expect(home.claude).not.toHaveProperty("activeLogin");
    expect(home.claude?.logins).toEqual(profile.claude.logins);
  });

  it("removing the active login returns the profile to its home login", () => {
    const next = profileWithoutLogin(profileWithActiveLogin(profile, "a1"), "a1");
    expect(next.claude?.logins).toEqual([{ id: "b2", name: "Team" }]);
    expect(next.claude).not.toHaveProperty("activeLogin");
    const other = profileWithoutLogin(profileWithActiveLogin(profile, "a1"), "b2");
    expect(other.claude?.activeLogin).toBe("a1");
  });
});
