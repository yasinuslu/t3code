import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse, HttpServerResponse } from "effect/unstable/http";

import * as ForgejoCli from "../sourceControl/ForgejoCli.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import { githubMediaResponse } from "./GitHubMediaFetch.ts";

const ATTACHMENT = "https://git.example.org/attachments/6e7b3081-55c9-4870-8bbe-91f260279661";

const harness = (requests: Array<{ url: string; authorization: string | undefined }>) =>
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
    Layer.mock(GitHubCli.GitHubCli)({}),
  );

const serve = (url: string) =>
  githubMediaResponse({ url, cwd: "/repo", expiresAt: Number.MAX_SAFE_INTEGER }, {});

describe("githubMediaResponse", () => {
  it.effect("serves a forge attachment with the fj login for its host", () => {
    const requests: Array<{ url: string; authorization: string | undefined }> = [];
    return Effect.gen(function* () {
      const response = yield* serve(ATTACHMENT);
      expect(response.status).toBe(200);
      expect(HttpServerResponse.toWeb(response).headers.get("content-type")).toBe("image/png");
      expect(requests).toEqual([{ url: ATTACHMENT, authorization: "token forge-token" }]);
    }).pipe(Effect.provide(harness(requests)));
  });

  it.effect("fetches nothing from a host this server holds no forge login for", () => {
    const requests: Array<{ url: string; authorization: string | undefined }> = [];
    return Effect.gen(function* () {
      const response = yield* serve(
        "https://elsewhere.example.com/attachments/6e7b3081-55c9-4870-8bbe-91f260279661",
      );
      expect(response.status).toBe(404);
      expect(requests).toEqual([]);
    }).pipe(Effect.provide(harness(requests)));
  });
});
