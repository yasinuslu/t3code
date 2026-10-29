import type { SourceControlMediaRequest } from "@t3tools/source-control-core/server/driver";
import * as Effect from "effect/Effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";

import * as ForgejoCli from "./ForgejoCli.ts";

const MAX_REDIRECTS = 3;
const MANUAL_REDIRECT: RequestInit = { redirect: "manual" };

export const make = Effect.gen(function* () {
  const cli = yield* ForgejoCli.ForgejoCli;
  const httpClient = HttpClient.withScope(yield* HttpClient.HttpClient);

  return Effect.fn("ForgejoMediaFetch.fetchMedia")(function* (request: SourceControlMediaRequest) {
    const origin = new URL(request.url);
    // Attachment URLs are claimed on any host, so only a server fj holds a token for is fetched:
    // anything else would make this server fetch whatever a pull request body names.
    const token = yield* (cli.tokenForHost?.(origin.host) ?? Effect.succeed(null)).pipe(
      Effect.orElseSucceed(() => null),
    );
    if (token === null) return null;
    let target = request.url;
    for (let hop = 0; ; hop += 1) {
      // Where a redirect leads, such as an object store, authorizes with its own signature.
      const sameOrigin = new URL(target).origin === origin.origin;
      const response: HttpClientResponse.HttpClientResponse = yield* httpClient
        .execute(
          HttpClientRequest.get(target).pipe(
            HttpClientRequest.setHeaders({
              ...request.headers,
              // The bytes are streamed straight through, so never let an encoding layer in.
              "accept-encoding": "identity",
              ...(sameOrigin ? { authorization: `token ${token}` } : {}),
            }),
          ),
        )
        .pipe(Effect.provideService(FetchHttpClient.RequestInit, MANUAL_REDIRECT));
      const location = response.headers.location;
      if (response.status < 300 || response.status >= 400) return response;
      if (!location || hop >= MAX_REDIRECTS) return null;
      const next = new URL(location, target);
      if (next.protocol !== "https:" && next.origin !== origin.origin) return null;
      target = next.toString();
    }
  });
});
