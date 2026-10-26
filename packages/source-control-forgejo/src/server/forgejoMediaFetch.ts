import type { SourceControlMediaRequest } from "@t3tools/source-control-core/server/driver";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ForgejoCli from "./ForgejoCli.ts";

const MAX_REDIRECTS = 3;
const MANUAL_REDIRECT: RequestInit = { redirect: "manual" };

/**
 * Fetches an attachment with the fj login for its host. That login is the allowlist: a host this
 * server holds none for gets a 404 without any request, so the media route is no open proxy. The
 * token rides only on requests to that host, never on a redirect to object storage.
 */
export const make = Effect.gen(function* () {
  const forgejo = yield* ForgejoCli.ForgejoCli;
  const httpClient = HttpClient.withScope(yield* HttpClient.HttpClient);

  return Effect.fn("ForgejoMediaFetch.fetchMedia")(function* (request: SourceControlMediaRequest) {
    const host = new URL(request.url).host.toLowerCase();
    const token =
      forgejo.hostToken === undefined
        ? null
        : yield* forgejo.hostToken({ cwd: request.cwd ?? globalThis.process.cwd(), host });
    if (token === null) {
      return HttpClientResponse.fromWeb(
        HttpClientRequest.get(request.url),
        new Response(null, { status: 404 }),
      );
    }
    let target = request.url;
    for (let hop = 0; ; hop += 1) {
      const authorization = new URL(target).host.toLowerCase() === host ? `token ${token}` : null;
      const response: HttpClientResponse.HttpClientResponse = yield* httpClient
        .execute(
          HttpClientRequest.get(target).pipe(
            HttpClientRequest.setHeaders({
              ...request.headers,
              // The bytes are streamed straight through, so never let an encoding layer in.
              "accept-encoding": "identity",
              ...(authorization === null ? {} : { authorization }),
            }),
          ),
        )
        .pipe(Effect.provideService(FetchHttpClient.RequestInit, MANUAL_REDIRECT));
      const location = response.headers.location;
      if (response.status < 300 || response.status >= 400) return response;
      if (!location || hop >= MAX_REDIRECTS) return null;
      const next = new URL(location, target);
      if (next.protocol !== "https:") return null;
      target = next.toString();
    }
  });
});
