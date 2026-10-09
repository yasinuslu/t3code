import {
  PREVIEW_STATUS_PATH,
  type PreviewLinkStatusInput,
  type PreviewLinkStatusResult,
  ThreadPreviewLinkState,
} from "@t3tools/contracts";
import { previewLinkOrigin } from "@t3tools/shared/threadPreviewLinks";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";

const STATUS_TIMEOUT = Duration.millis(1_500);
const STATUS_TTL = Duration.seconds(5);
const MAX_CACHED_ORIGINS = 512;
/** One request reads at most this many previews; a thread keeps ten. */
const MAX_URLS_PER_REQUEST = 100;

const decodeStatusBody = Schema.decodeUnknownOption(
  Schema.Struct({ state: ThreadPreviewLinkState }),
);

/**
 * Whether thread previews are up. Reads `<origin>/.well-known/preview-status`, which preview
 * hosts answer without waking the preview, and caches each origin briefly so every client
 * polling the same previews shares one read. Anything other than a 2xx JSON `{state}` answer
 * is `unknown`; reads never fail.
 */
export class PreviewLinkStatus extends Context.Service<
  PreviewLinkStatus,
  {
    readonly status: (input: PreviewLinkStatusInput) => Effect.Effect<PreviewLinkStatusResult>;
    /** One preview's state; `unknown` when its host does not answer the status protocol. */
    readonly probe: (url: string) => Effect.Effect<ThreadPreviewLinkState>;
  }
>()("t3/preview/PreviewLinkStatus") {}

const make = Effect.gen(function* () {
  const httpClient = (yield* HttpClient.HttpClient).pipe(HttpClient.withScope);

  const read = (origin: string): Effect.Effect<ThreadPreviewLinkState> =>
    httpClient
      .get(`${origin}${PREVIEW_STATUS_PATH}`, { headers: { accept: "application/json" } })
      .pipe(
        Effect.flatMap((response) =>
          response.status >= 200 && response.status < 300
            ? response.json.pipe(
                Effect.map((body) =>
                  Option.match(decodeStatusBody(body), {
                    onNone: () => "unknown" as const,
                    onSome: ({ state }) => state,
                  }),
                ),
              )
            : Effect.succeed("unknown" as const),
        ),
        Effect.scoped,
        Effect.timeoutOption(STATUS_TIMEOUT),
        Effect.map(Option.getOrElse(() => "unknown" as const)),
        Effect.orElseSucceed(() => "unknown" as const),
        // A redirect usually points at a sign-in page; following it would wake nothing useful.
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      );

  // The cache also joins concurrent reads of one origin into a single request.
  const byOrigin = yield* Cache.make({
    capacity: MAX_CACHED_ORIGINS,
    timeToLive: STATUS_TTL,
    lookup: read,
  });

  const probe = (url: string): Effect.Effect<ThreadPreviewLinkState> => {
    const origin = previewLinkOrigin(url);
    return origin === null ? Effect.succeed("unknown") : Cache.get(byOrigin, origin);
  };

  const status = Effect.fn("PreviewLinkStatus.status")(function* (input: PreviewLinkStatusInput) {
    const urls = [...new Set(input.urls)].slice(0, MAX_URLS_PER_REQUEST);
    const statuses = yield* Effect.forEach(
      urls,
      (url) => probe(url).pipe(Effect.map((state) => ({ url, state }))),
      { concurrency: "unbounded" },
    );
    return { statuses };
  });

  return PreviewLinkStatus.of({ status, probe });
});

export const layer = Layer.effect(PreviewLinkStatus, make);
