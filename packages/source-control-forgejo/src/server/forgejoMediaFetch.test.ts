import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ForgejoCli from "./ForgejoCli.ts";
import * as ForgejoMediaFetch from "./forgejoMediaFetch.ts";

const url = "https://git.example.test/attachments/b83ecd50-40d3-4a61-bc9a-88535f7a75a9";

const run = (
  tokens: Record<string, string>,
  respond: (request: URL, authorization: string | undefined) => Response,
) => {
  const seen: Array<[string, string | undefined]> = [];
  return {
    seen,
    fetch: Effect.gen(function* () {
      const fetchMedia = yield* ForgejoMediaFetch.make;
      return yield* fetchMedia({ url, headers: {} });
    }).pipe(
      Effect.provide(
        Layer.mock(ForgejoCli.ForgejoCli)({
          tokenForHost: (host) => Effect.succeed(tokens[host] ?? null),
        }),
      ),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          const target = new URL(request.url);
          seen.push([target.host, request.headers.authorization]);
          return Effect.succeed(
            HttpClientResponse.fromWeb(request, respond(target, request.headers.authorization)),
          );
        }),
      ),
      Effect.scoped,
    ),
  };
};

describe("ForgejoMediaFetch", () => {
  it.effect("sends the fj token to the server the upload lives on", () => {
    const { seen, fetch } = run({ "git.example.test": "secret" }, (_, authorization) =>
      authorization
        ? new Response(null, { status: 200, headers: { "content-type": "image/png" } })
        : new Response(null, { status: 303, headers: { location: "/user/login" } }),
    );
    return Effect.gen(function* () {
      expect((yield* fetch)?.status).toBe(200);
      expect(seen).toEqual([["git.example.test", "token secret"]]);
    });
  });

  it.effect("fetches nothing from a server fj holds no token for", () => {
    const { seen, fetch } = run({}, () => new Response(null, { status: 200 }));
    return Effect.gen(function* () {
      expect(yield* fetch).toBeNull();
      expect(seen).toEqual([]);
    });
  });

  it.effect("keeps the token off the object store a redirect hands the upload to", () => {
    const { seen, fetch } = run({ "git.example.test": "secret" }, (target) =>
      target.host === "git.example.test"
        ? new Response(null, {
            status: 303,
            headers: { location: "https://objects.example.com/s" },
          })
        : new Response(null, { status: 200 }),
    );
    return Effect.gen(function* () {
      expect((yield* fetch)?.status).toBe(200);
      expect(seen).toEqual([
        ["git.example.test", "token secret"],
        ["objects.example.com", undefined],
      ]);
    });
  });
});
