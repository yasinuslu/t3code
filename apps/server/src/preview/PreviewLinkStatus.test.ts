import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";

import * as PreviewLinkStatus from "./PreviewLinkStatus.ts";

type Answer = "running" | "not-found" | "html" | "refused" | "hang";

/** A preview host per origin; records every status read it receives. */
function fakeHosts(answers: Readonly<Record<string, Answer>>) {
  const requests: Array<string> = [];
  const client = HttpClient.make((request) => {
    requests.push(request.url);
    const answer = answers[new URL(request.url).origin];
    switch (answer) {
      case "running":
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, Response.json({ state: "running" })),
        );
      case "html":
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response("<html>sign in</html>")),
        );
      case "hang":
        return Effect.never;
      case "not-found":
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response("missing", { status: 404 })),
        );
      default:
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, description: "refused" }),
          }),
        );
    }
  });
  return {
    requests,
    layer: PreviewLinkStatus.layer.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    ),
  };
}

describe("PreviewLinkStatus", () => {
  it.effect("reads each origin's status once and caches it briefly", () => {
    const hosts = fakeHosts({ "https://a.pv.example.org": "running" });
    return Effect.gen(function* () {
      const service = yield* PreviewLinkStatus.PreviewLinkStatus;
      const result = yield* service.status({
        urls: ["https://a.pv.example.org", "https://a.pv.example.org/settings"],
      });
      assert.deepEqual(result.statuses, [
        { url: "https://a.pv.example.org", state: "running" },
        { url: "https://a.pv.example.org/settings", state: "running" },
      ]);
      assert.deepEqual(hosts.requests, ["https://a.pv.example.org/.well-known/preview-status"]);

      yield* service.status({ urls: ["https://a.pv.example.org"] });
      assert.strictEqual(hosts.requests.length, 1);

      yield* TestClock.adjust("6 seconds");
      yield* service.status({ urls: ["https://a.pv.example.org"] });
      assert.strictEqual(hosts.requests.length, 2);
    }).pipe(Effect.provide(hosts.layer));
  });

  it.effect("reports unknown for hosts that do not answer the protocol", () => {
    const hosts = fakeHosts({
      "https://missing.example.org": "not-found",
      "https://html.example.org": "html",
      "https://down.example.org": "refused",
    });
    return Effect.gen(function* () {
      const service = yield* PreviewLinkStatus.PreviewLinkStatus;
      const result = yield* service.status({
        urls: [
          "https://missing.example.org",
          "https://html.example.org",
          "https://down.example.org",
          "ftp://files.example.org",
        ],
      });
      assert.deepEqual(
        result.statuses.map((entry) => entry.state),
        ["unknown", "unknown", "unknown", "unknown"],
      );
    }).pipe(Effect.provide(hosts.layer));
  });

  it.effect("gives up on a host that does not answer in time", () => {
    const hosts = fakeHosts({ "https://slow.example.org": "hang" });
    return Effect.gen(function* () {
      const service = yield* PreviewLinkStatus.PreviewLinkStatus;
      const fiber = yield* service.probe("https://slow.example.org").pipe(Effect.forkChild);
      yield* TestClock.adjust("1500 millis");
      assert.strictEqual(yield* Fiber.join(fiber), "unknown");
    }).pipe(Effect.provide(hosts.layer));
  });
});
