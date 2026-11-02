import { assert, describe, it } from "@effect/vitest";

import { gitCodeFilesToPatch } from "./GitCodePullRequestProvider.ts";

describe("gitCodeFilesToPatch", () => {
  it("joins GitCode's per-file hunks into one unified patch", () => {
    const result = gitCodeFilesToPatch([
      {
        filename: "README.md",
        patch: { diff: "@@ -1 +1 @@\n-old\n+new\n", old_path: "README.md", new_path: "README.md" },
      },
      {
        filename: "src/new.ts",
        patch: { diff: "@@ -0,0 +1 @@\n+export {};", new_path: "src/new.ts", new_file: 1 },
      },
    ]);
    assert.strictEqual(
      result.patch,
      [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "diff --git a/src/new.ts b/src/new.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/src/new.ts",
        "@@ -0,0 +1 @@",
        "+export {};",
        "",
      ].join("\n"),
    );
    assert.strictEqual(result.truncated, false);
  });

  it("reports a file GitCode withheld as too large", () => {
    const result = gitCodeFilesToPatch([
      { filename: "big.bin", patch: { new_path: "big.bin", too_large: true } },
    ]);
    assert.strictEqual(result.patch, "diff --git a/big.bin b/big.bin\n");
    assert.strictEqual(result.truncated, true);
  });
});
