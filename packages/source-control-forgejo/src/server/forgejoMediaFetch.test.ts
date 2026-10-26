import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import { forgejoMediaUrl } from "../shared/forgejoMedia.ts";
import * as ForgejoCli from "./ForgejoCli.ts";
import * as ForgejoMediaFetch from "./forgejoMediaFetch.ts";

const ATTACHMENT = "https://git.example.org/attachments/6e7b3081-55c9-4870-8bbe-91f260279661";

const fetchWith = (requests: Array<{ url: string; authorization: string | undefined }>) =>
  Effect.provide(
    Layer.mergeAll(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          requests.push({ url: request.url, authorization: request.headers.authorization });
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response("png", { headers: { "content-type": "image/png" } }),
            ),
          );
        }),
      ),
      Layer.mock(ForgejoCli.ForgejoCli)({
        hostToken: ({ host }) => Effect.succeed(host === "git.example.org" ? "forge-token" : null),
      }),
    ),
  );

describe("forgejoMediaUrl", () => {
  it("reads attachments with or without the repository and rejects other shapes", () => {
    expect(
      forgejoMediaUrl(
        new URL(
          "https://Git.Example.org/owner/repo/attachments/6E7B3081-55c9-4870-8bbe-91f260279661",
        ),
      )?.fetchUrl,
    ).toBe(ATTACHMENT);
    for (const url of [
      "http://git.example.org/attachments/6e7b3081-55c9-4870-8bbe-91f260279661",
      "https://git.example.org/attachments/not-a-uuid",
      "https://git.example.org/a/b/c/attachments/6e7b3081-55c9-4870-8bbe-91f260279661",
    ]) {
      expect(forgejoMediaUrl(new URL(url))).toBeNull();
    }
  });
});

describe("ForgejoMediaFetch", () => {
  it.effect("serves a forge attachment with the fj login for its host", () => {
    const requests: Array<{ url: string; authorization: string | undefined }> = [];
    return Effect.gen(function* () {
      const fetchMedia = yield* ForgejoMediaFetch.make;
      const response = yield* fetchMedia({ url: ATTACHMENT, headers: {}, cwd: "/repo" });
      expect(response?.status).toBe(200);
      expect(requests).toEqual([{ url: ATTACHMENT, authorization: "token forge-token" }]);
    }).pipe(fetchWith(requests), Effect.scoped);
  });

  it.effect("fetches nothing from a host this server holds no forge login for", () => {
    const requests: Array<{ url: string; authorization: string | undefined }> = [];
    return Effect.gen(function* () {
      const fetchMedia = yield* ForgejoMediaFetch.make;
      const response = yield* fetchMedia({
        url: "https://elsewhere.example.com/attachments/6e7b3081-55c9-4870-8bbe-91f260279661",
        headers: {},
        cwd: "/repo",
      });
      expect(response?.status).toBe(404);
      expect(requests).toEqual([]);
    }).pipe(fetchWith(requests), Effect.scoped);
  });
});
