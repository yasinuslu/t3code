import { EnvironmentId, type ThreadPreviewLinkState } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { createPreviewLinkStatesWith, previewLinkLabel } from "./previewLinks.ts";

const ENVIRONMENT = EnvironmentId.make("environment-preview-links");
const A = "https://a.pv.example.org";
const B = "https://b.pv.example.org";
const C = "https://c.pv.example.org";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function harness(states: Readonly<Record<string, ThreadPreviewLinkState>>) {
  const reads: Array<ReadonlyArray<string>> = [];
  const previews = createPreviewLinkStatesWith(async (_registry, _environmentId, urls) => {
    reads.push(urls);
    return urls.map((url) => ({ url, state: states[url] ?? "unknown" }));
  });
  return { reads, previews, registry: AtomRegistry.make() };
}

it("reads every mounted preview in one request and stops when nothing is mounted", async () => {
  const { reads, previews, registry } = harness({ [A]: "running", [B]: "stopped" });
  const rowA = previews.statesAtom({ environmentId: ENVIRONMENT, urls: [A] });
  const rowAB = previews.statesAtom({ environmentId: ENVIRONMENT, urls: [B, A] });
  const unmountA = registry.mount(rowA);
  const unmountAB = registry.mount(rowAB);

  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toEqual([[A, B]]);
  expect(registry.get(rowAB)).toEqual(
    new Map<string, ThreadPreviewLinkState>([
      [A, "running"],
      [B, "stopped"],
    ]),
  );

  // A new URL is read on its own right away; the shared loop reads everything every 30 s.
  const unmountC = registry.mount(previews.statesAtom({ environmentId: ENVIRONMENT, urls: [C] }));
  await vi.advanceTimersByTimeAsync(0);
  expect(reads.at(-1)).toEqual([C]);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(reads.at(-1)).toEqual([A, B, C]);
  expect(reads).toHaveLength(3);

  // Opening a preview re-reads it after it has had time to wake.
  previews.refresh(ENVIRONMENT, [B]);
  await vi.advanceTimersByTimeAsync(6_000);
  expect(reads.at(-1)).toEqual([B]);
  await vi.advanceTimersByTimeAsync(9_000);
  expect(reads.at(-1)).toEqual([B]);
  expect(reads).toHaveLength(5);

  unmountA();
  unmountAB();
  unmountC();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(reads).toHaveLength(5);
});

it("names a preview by its label or its host's first DNS label", () => {
  expect(previewLinkLabel({ url: "http://t3code-my-branch.pv.example.org/app" })).toBe(
    "t3code-my-branch",
  );
  expect(previewLinkLabel({ url: "http://localhost:5173", label: "Docs" })).toBe("Docs");
  expect(previewLinkLabel({ url: "http://localhost:5173" })).toBe("localhost:5173");
  expect(previewLinkLabel({ url: "http://192.168.1.4:3000" })).toBe("192.168.1.4:3000");
});
