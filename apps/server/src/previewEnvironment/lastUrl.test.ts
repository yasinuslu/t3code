import { expect, it } from "vitest";

import { lastUrl } from "./lastUrl.ts";

it("takes the last URL", () => {
  expect(lastUrl("building\nhttp://localhost:3000\nready at https://x.pv.example.org/app\n")).toBe(
    "https://x.pv.example.org/app",
  );
});

it("drops trailing punctuation and wrappers", () => {
  expect(lastUrl("open (http://a.test/x).")).toBe("http://a.test/x");
  expect(lastUrl("see https://a.test/x?y=1, then")).toBe("https://a.test/x?y=1");
});

it("returns null without a URL", () => {
  expect(lastUrl("done\nno link here")).toBeNull();
  expect(lastUrl("")).toBeNull();
});
