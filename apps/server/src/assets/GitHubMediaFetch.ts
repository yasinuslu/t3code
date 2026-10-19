import * as Mime from "effect/unstable/http/Mime";
import { githubMediaFetchUrl, githubMediaFileName } from "@t3tools/shared/githubMedia";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpServerResponse,
  type HttpClientResponse,
} from "effect/unstable/http";

import * as ForgejoCli from "../sourceControl/ForgejoCli.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";

/**
 * Exactly the hosts the credential is for. Everything a redirect leads to — the presigned
 * object stores GitHub hands assets off to — authorizes with its own signature, and some of
 * them reject a request that also carries a bearer token.
 */
const CREDENTIALED_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "raw.githubusercontent.com",
  "media.githubusercontent.com",
]);
const hostOf = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

/** GitHub answers an asset request with a 302 to a signed object URL that needs no credential. */
const MAX_REDIRECTS = 3;
/** Following the redirect here, rather than in `fetch`, is what keeps the token on GitHub. */
const MANUAL_REDIRECT: RequestInit = { redirect: "manual" };
const TOKEN_CACHE_TTL_MS = 5 * 60_000;
const TOKEN_CACHE_MAX_ENTRIES = 32;
/** Passed through so a seek in a long video costs one upstream range request, not a full download. */
const FORWARDED_REQUEST_HEADERS = ["range", "if-range"] as const;
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
] as const;
/** A pull request embeds pictures and recordings. Anything else is not served from our origin. */
const MEDIA_CONTENT_TYPE_PATTERN = /^(?:image|video|audio)\/[\w!#$&^.+-]+$/i;
const SVG_CONTENT_TYPE = "image/svg+xml";
// An SVG is a document: same policy the asset route gives a workspace SVG, so one embedded in a
// body cannot run script against this origin.
const SVG_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * A media request per image and one per video seek, each of which would otherwise spawn `gh`.
 * The token is what `gh auth token` would print again on the next call, and it is held no longer
 * than a signed asset URL lives.
 */
const tokenCache = new Map<string, { readonly at: number; readonly token: Redacted.Redacted }>();

const githubToken = Effect.fn("GitHubMediaFetch.githubToken")(function* (input: {
  readonly cwd: string;
  readonly host: string;
}) {
  // `gh` stores a token per host, not per repository, so the directory it runs in is not part
  // of the answer and must not fragment the cache a client could otherwise churn. This route
  // pins no credential; if it ever does, the pin belongs in this key.
  const key = input.host;
  const now = yield* Clock.currentTimeMillis;
  const cached = tokenCache.get(key);
  if (cached !== undefined && now - cached.at < TOKEN_CACHE_TTL_MS) return cached.token;
  const github = yield* GitHubCli.GitHubCli;
  // No credential is a normal state: a public asset still loads, and a private one fails the way
  // it does in a browser that is not signed in.
  const token = yield* github
    .execute({
      cwd: input.cwd,
      args: ["auth", "token", "--hostname", input.host],
      env: { GH_DEBUG: "" },
    })
    .pipe(
      Effect.map((output) => output.stdout.trim()),
      Effect.orElseSucceed(() => ""),
    );
  // A login or recovered CLI failure must take effect on the next media request.
  if (token.length === 0) return null;
  if (tokenCache.size >= TOKEN_CACHE_MAX_ENTRIES) {
    tokenCache.delete(tokenCache.keys().next().value!);
  }
  const redacted = Redacted.make(token);
  tokenCache.set(key, { at: now, token: redacted });
  return redacted;
});

/** A credential and the only hosts it may be sent to. */
interface MediaCredential {
  readonly authorization: Redacted.Redacted;
  readonly hosts: ReadonlySet<string>;
}

/**
 * Follows GitHub's redirect to the signed object itself, and never carries the credential off
 * GitHub: the object URL authorizes with its own signature, and the store it lives in has no
 * business seeing a token. A forge's credential likewise stays on the forge.
 */
const fetchFollowingRedirects = Effect.fn("GitHubMediaFetch.fetchFollowingRedirects")(function* (
  url: string,
  headers: Record<string, string>,
  credential: MediaCredential | null,
) {
  const httpClient = HttpClient.withScope(yield* HttpClient.HttpClient);
  let target = url;
  for (let hop = 0; ; hop += 1) {
    // The credential rides only on a request to GitHub itself. A redirect leads to a signed
    // object URL that authorizes on its own, and the store it lives in has no business seeing
    // a token — deciding that from the target, not from the hop count, is what makes it so.
    const targetHost = hostOf(target);
    const authorization =
      credential !== null && targetHost !== null && credential.hosts.has(targetHost)
        ? Redacted.value(credential.authorization)
        : null;
    const response: HttpClientResponse.HttpClientResponse = yield* httpClient
      .execute(
        HttpClientRequest.get(target).pipe(
          HttpClientRequest.setHeaders({
            ...headers,
            // The bytes are streamed straight through, so never let an encoding layer in.
            "accept-encoding": "identity",
            ...(authorization === null ? {} : { authorization }),
          }),
        ),
      )
      .pipe(Effect.provideService(FetchHttpClient.RequestInit, MANUAL_REDIRECT));
    const location = response.headers.location;
    if (response.status < 300 || response.status >= 400) return response;
    // A chain this long is not GitHub answering with bytes, and its body is not the media.
    if (!location || hop >= MAX_REDIRECTS) return null;
    const next = new URL(location, target);
    if (next.protocol !== "https:") return null;
    target = next.toString();
  }
});

/**
 * The credential for a forge attachment, or null when this server holds no Forgejo login for its
 * host. That login is the allowlist: without one the server fetches nothing, so the route is no
 * open proxy.
 */
const forgeCredential = Effect.fn("GitHubMediaFetch.forgeCredential")(function* (input: {
  readonly cwd: string;
  readonly url: string;
}) {
  const host = hostOf(input.url);
  const forgejo = yield* ForgejoCli.ForgejoCli;
  if (host === null || forgejo.hostToken === undefined) return null;
  const token = yield* forgejo.hostToken({ cwd: input.cwd, host });
  return token === null
    ? null
    : ({
        authorization: Redacted.make(`token ${token}`),
        hosts: new Set([host]),
      } satisfies MediaCredential);
});

/**
 * Serves media a pull request body points at on GitHub through the `gh` credential, which is the
 * only thing that distinguishes a readable private attachment from a 404, and a Forgejo
 * attachment through the `fj` login for its host.
 */
export const githubMediaResponse = Effect.fn("GitHubMediaFetch.githubMediaResponse")(function* (
  asset: { readonly url: string; readonly cwd: string; readonly expiresAt: number },
  requestHeaders: Record<string, string | undefined>,
) {
  let credential: MediaCredential | null;
  if (githubMediaFetchUrl(asset.url) !== null) {
    // Both media hosts are served by github.com's account, which is the host `gh` stores it under.
    const token = yield* githubToken({ cwd: asset.cwd, host: "github.com" });
    credential =
      token === null
        ? null
        : {
            authorization: Redacted.make(`Bearer ${Redacted.value(token)}`),
            hosts: CREDENTIALED_HOSTS,
          };
  } else {
    credential = yield* forgeCredential({ cwd: asset.cwd, url: asset.url });
    if (credential === null) {
      return HttpServerResponse.empty({
        status: 404,
        headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
      });
    }
  }
  const forwarded: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = requestHeaders[name];
    if (value !== undefined) forwarded[name] = value;
  }
  const response = yield* fetchFollowingRedirects(asset.url, forwarded, credential);
  // An upload GitHub hosts never changes under its URL, so the only thing a cached copy must
  // not outlive is the signed URL that granted it — which is the same bound the URL itself has.
  const remainingSeconds = Math.floor((asset.expiresAt - (yield* Clock.currentTimeMillis)) / 1000);
  const headers: Record<string, string> = {
    "cache-control":
      remainingSeconds > 0 ? `private, max-age=${remainingSeconds}` : "private, no-store",
    "x-content-type-options": "nosniff",
  };
  if (response === null) return HttpServerResponse.empty({ status: 502, headers });
  // An upstream refusal is the client's answer, not this server's fault; only a broken hop is.
  // It carries none of the upstream entity headers: a `content-length` with no body behind it
  // holds the connection open until the browser gives up on it.
  if (response.status >= 400) {
    return HttpServerResponse.empty({
      status: response.status >= 500 ? 502 : response.status,
      headers,
    });
  }
  // Only pictures and recordings leave this origin, and never on GitHub's word alone: the raw
  // host labels every committed binary `application/octet-stream`, so the name decides those.
  const upstreamType =
    response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const contentType = MEDIA_CONTENT_TYPE_PATTERN.test(upstreamType)
    ? upstreamType
    : Option.getOrElse(Mime.getType(githubMediaFileName(asset.url)), () => "").toLowerCase();
  if (!MEDIA_CONTENT_TYPE_PATTERN.test(contentType)) {
    return HttpServerResponse.empty({ status: 415, headers });
  }
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  headers["content-type"] = contentType;
  if (contentType === SVG_CONTENT_TYPE) {
    headers["content-security-policy"] = SVG_CONTENT_SECURITY_POLICY;
  }
  return HttpServerResponse.stream(response.stream, {
    status: response.status,
    headers,
    contentType,
  });
});
