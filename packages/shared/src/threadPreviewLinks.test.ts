import { describe, expect, it } from "vite-plus/test";

import { isLoopbackPreviewUrl } from "./threadPreviewLinks.ts";

describe("isLoopbackPreviewUrl", () => {
  it.each([
    "http://localhost:5173",
    "http://app.localhost:3000/x",
    "http://127.0.0.1:8421",
    "http://127.1.2.3",
    "http://[::1]:3000",
    "http://0.0.0.0:8080",
  ])("rejects %s", (url) => {
    expect(isLoopbackPreviewUrl(url)).toBe(true);
  });

  it.each([
    "https://t3code-fix.pv.nepjua.org",
    "https://nika.burmese-shiner.ts.net:8443",
    "http://100.119.28.68:3000",
    "https://localhost.example.org",
  ])("allows %s", (url) => {
    expect(isLoopbackPreviewUrl(url)).toBe(false);
  });
});
