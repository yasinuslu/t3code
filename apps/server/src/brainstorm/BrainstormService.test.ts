import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { fastBrainstormModelSelection } from "./BrainstormService.ts";

const claude = ProviderDriverKind.make("claudeAgent");
const codex = ProviderDriverKind.make("codex");
const provider = (
  instanceId: string,
  driver: ProviderDriverKind,
  slugs: ReadonlyArray<string>,
  enabled = true,
) =>
  ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver,
    enabled,
    models: slugs.map((slug) => ({ slug })),
  }) as unknown as Parameters<typeof fastBrainstormModelSelection>[0][number];

const opus = { instanceId: ProviderInstanceId.make("work"), model: "claude-opus-5-5" };
const low = [{ id: "effort", value: "low" }];

describe("fastBrainstormModelSelection", () => {
  it("picks Sonnet at low effort on the instance the project already uses", () => {
    expect(
      fastBrainstormModelSelection(
        [
          provider("claudeAgent", claude, ["claude-sonnet-5-5"]),
          provider("work", claude, ["claude-opus-5-5", "claude-sonnet-5-5"]),
        ],
        opus,
      ),
    ).toEqual({ instanceId: "work", model: "claude-sonnet-5-5", options: low });
  });

  it("falls back to an older Sonnet and to another enabled Claude instance", () => {
    expect(
      fastBrainstormModelSelection(
        [
          provider("work", claude, ["claude-sonnet-5-5"], false),
          provider("claudeAgent", claude, ["claude-sonnet-5"]),
        ],
        opus,
      ),
    ).toEqual({ instanceId: "claudeAgent", model: "claude-sonnet-5", options: low });
  });

  it("returns null without a Claude instance that offers Sonnet", () => {
    expect(fastBrainstormModelSelection([provider("codex", codex, ["gpt-6-sol"])], opus)).toBe(
      null,
    );
  });
});
