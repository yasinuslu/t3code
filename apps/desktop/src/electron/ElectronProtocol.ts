import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Mime from "effect/http/Mime";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

export const DESKTOP_HOST = "app";
const DESKTOP_PRODUCTION_SCHEME = "t3code";
const DESKTOP_DEVELOPMENT_SCHEME = "t3code-dev";

export function getDesktopScheme(isDevelopment: boolean): string {
  return isDevelopment ? DESKTOP_DEVELOPMENT_SCHEME : DESKTOP_PRODUCTION_SCHEME;
}

function getDesktopOrigin(isDevelopment: boolean): string {
  return `${getDesktopScheme(isDevelopment)}://${DESKTOP_HOST}`;
}

export function getDesktopUrl(isDevelopment: boolean): string {
  return `${getDesktopOrigin(isDevelopment)}/`;
}

export class ElectronProtocolRegistrationError extends Schema.TaggedError<ElectronProtocolRegistrationError>()(
  "ElectronProtocolRegistrationError",
  {
    scheme: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to register Electron protocol scheme "${this.scheme}".`;
  }
}

export class ElectronProtocolUnregistrationError extends Schema.TaggedError<ElectronProtocolUnregistrationError>()(
  "ElectronProtocolUnregistrationError",
  {
    scheme: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to unregister Electron protocol scheme "${this.scheme}".`;
  }
}

export type DesktopProtocolRegistrationInput = {
  readonly scheme: string;
  readonly clerkFrontendApiHostname: string | undefined;
} & ({ readonly targetOrigin: URL } | { readonly assetDirectory: string });

export class ElectronProtocol extends Context.Service<
  ElectronProtocol,
  {
    readonly registerDesktopProtocol: (
      input: DesktopProtocolRegistrationInput,
    ) => Effect.Effect<void, ElectronProtocolRegistrationError, Scope.Scope>;
  }
>()("@t3tools/desktop/electron/ElectronProtocol") {}

function makeDesktopContentSecurityPolicy(input: DesktopProtocolRegistrationInput): string {
  const clerkOrigin = input.clerkFrontendApiHostname
    ? `https://${input.clerkFrontendApiHostname}`
    : undefined;
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    // The inline web-component library arrives over the socket and is imported from a blob URL.
    "blob:",
    ...(clerkOrigin ? [clerkOrigin] : []),
    "https://challenges.cloudflare.com",
  ];

  // User-configured environment origins are unknown here, so allow supported network schemes.
  // GLTFLoader fetches embedded textures through blob URLs.
  const connectSources = ["'self'", "blob:", "http:", "https:", "ws:", "wss:"];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    `img-src 'self' ${input.scheme}: blob: data: http: https:`,
    `media-src 'self' ${input.scheme}: blob: http: https:`,
    "style-src 'self' 'unsafe-inline'",
    `font-src 'self' ${input.scheme}: data:`,
    "worker-src 'self' blob:",
    "frame-src 'self' blob: http: https:",
    "object-src 'self' blob: http: https:",
    "form-action 'self'",
  ].join("; ");
}

function withContentSecurityPolicy(response: Response, policy: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", policy);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Must run synchronously before Electron emits ready.
function registerDesktopSchemePrivilegesSync(): void {
  Electron.protocol.registerSchemesAsPrivileged([
    {
      scheme: DESKTOP_PRODUCTION_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        // Custom schemes must opt into V8 caching; dev URLs serve changing code.
        codeCache: true,
      },
    },
    {
      scheme: DESKTOP_DEVELOPMENT_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

const registerDesktopSchemePrivileges = Effect.sync(registerDesktopSchemePrivilegesSync).pipe(
  Effect.withSpan("desktop.electron.protocol.registerSchemePrivileges"),
);

export const layerSchemePrivileges = Layer.effectDiscard(registerDesktopSchemePrivileges);

/**
 * Runs at most `maxInFlight` tasks at once and queues the rest in arrival
 * order. A slot frees when a task settles.
 */
export function makeConcurrencyLimiter(maxInFlight: number) {
  let inFlight = 0;
  const waiting: Array<() => void> = [];
  const acquire = (): Promise<void> => {
    if (inFlight < maxInFlight) {
      inFlight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    // The slot passes straight to the next waiter, so inFlight stays put.
    if (next) next();
    else inFlight -= 1;
  };
  return async <A>(task: () => Promise<A>): Promise<A> => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}

// On a cold dev server the renderer requests hundreds of modules at once. Each
// becomes an Electron.net.fetch in the network service, and an unbounded burst
// exhausts its request limit (net::ERR_INSUFFICIENT_RESOURCES), failing the
// import of the app entry. Bounding the proxied requests keeps the burst under
// that limit; the rest wait their turn.
const DEV_PROXY_MAX_IN_FLIGHT = 48;
const limitDevProxyFetch = makeConcurrencyLimiter(DEV_PROXY_MAX_IN_FLIGHT);

const TRANSIENT_FETCH_RETRY_DELAYS_MS = [0, 50, 150] as const;
// The network service frees capacity only as other requests finish, so give
// it longer to recover than a dev server that is still starting.
const INSUFFICIENT_RESOURCES_RETRY_DELAYS_MS = [0, 100, 250, 500, 1_000, 2_000] as const;

function isInsufficientResourcesError(error: unknown): boolean {
  return String(
    (error as { cause?: { message?: unknown } } | null)?.cause?.message ?? error,
  ).includes("ERR_INSUFFICIENT_RESOURCES");
}

class ElectronProtocolFetchError extends Schema.TaggedError<ElectronProtocolFetchError>()(
  "ElectronProtocolFetchError",
  { cause: Schema.Defect() },
) {}

const netFetch = (url: string, init: RequestInit) =>
  Effect.tryPromise({
    try: () => limitDevProxyFetch(() => Electron.net.fetch(url, init)),
    catch: (cause) => new ElectronProtocolFetchError({ cause }),
  });

const fetchWithTransientRetry = Effect.fn("desktop.protocol.fetchWithTransientRetry")(function* (
  url: string,
  init: RequestInit,
) {
  let lastError: ElectronProtocolFetchError | undefined;
  for (let attempt = 0; ; attempt += 1) {
    const delays =
      lastError !== undefined && isInsufficientResourcesError(lastError)
        ? INSUFFICIENT_RESOURCES_RETRY_DELAYS_MS
        : TRANSIENT_FETCH_RETRY_DELAYS_MS;
    if (attempt >= delays.length) break;
    const delayMs = delays[attempt] ?? 0;
    if (delayMs > 0) yield* Effect.sleep(delayMs);
    const result = yield* netFetch(url, init).pipe(
      Effect.map((response) => ({ response })),
      Effect.catch((error) => Effect.succeed({ error })),
    );
    if ("response" in result) return result.response;
    lastError = result.error;
  }
  return yield* lastError!;
});

const proxyRequest = Effect.fn("desktop.protocol.proxyRequest")(function* (
  request: Request,
  targetOrigin: URL,
  contentSecurityPolicy: string,
) {
  const requestUrl = new URL(request.url);
  if (requestUrl.host !== DESKTOP_HOST) {
    return new Response(null, { status: 404 });
  }

  const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, targetOrigin);
  const headers = new Headers(request.headers);
  const headersToRemove: string[] = [];
  for (const name of headers.keys()) {
    if (
      name === "host" ||
      name === "origin" ||
      name === "referer" ||
      name === "connection" ||
      name === "content-length" ||
      name === "accept-encoding" ||
      name === "upgrade-insecure-requests" ||
      name.startsWith("sec-fetch-")
    ) {
      headersToRemove.push(name);
    }
  }
  for (const name of headersToRemove) {
    headers.delete(name);
  }
  const init: RequestInit = {
    method: request.method,
    headers,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    (init as RequestInit & { duplex: "half" }).duplex = "half";
  }
  const response =
    request.method === "GET" || request.method === "HEAD"
      ? yield* fetchWithTransientRetry(targetUrl.toString(), init)
      : yield* netFetch(targetUrl.toString(), init);
  return withContentSecurityPolicy(response, contentSecurityPolicy);
});

const serveDesktopAsset = Effect.fn("desktop.protocol.serveAsset")(function* (
  request: Request,
  assetDirectory: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const url = new URL(request.url);
  if (url.host !== DESKTOP_HOST) return new Response(null, { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405 });
  }
  const pathname = yield* Effect.try(() => decodeURIComponent(url.pathname)).pipe(
    Effect.orElseSucceed(() => null),
  );
  if (pathname === null || pathname.includes("\0")) return new Response(null, { status: 400 });
  const root = path.resolve(assetDirectory);
  const assetPath = path.resolve(root, `.${pathname}`);
  if (assetPath !== root && !assetPath.startsWith(root + path.sep)) {
    return new Response(null, { status: 404 });
  }
  const stat = yield* fileSystem.stat(assetPath).pipe(Effect.orElseSucceed(() => null));
  let filePath = assetPath;
  if (stat?.type !== "File") {
    const wantsHtml = request.headers.get("accept")?.includes("text/html") ?? false;
    if (path.extname(assetPath) !== "" && !wantsHtml) {
      return new Response(null, { status: 404 });
    }
    filePath = path.join(root, "index.html");
  }
  const contents = yield* fileSystem.readFile(filePath).pipe(Effect.orElseSucceed(() => null));
  if (contents === null) return new Response(null, { status: 404 });
  return new Response(request.method === "HEAD" ? null : new Uint8Array(contents), {
    headers: {
      "content-type": Option.getOrElse(Mime.getType(filePath), () => "application/octet-stream"),
    },
  });
});

/** @public */
export const make = Effect.gen(function* () {
  const registered = yield* Ref.make(false);
  const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const runPromise = Effect.runPromiseWith(context);

  const registerDesktopProtocol = Effect.fn("desktop.electron.protocol.registerDesktopProtocol")(
    function* (input: DesktopProtocolRegistrationInput) {
      if (yield* Ref.get(registered)) return;

      const contentSecurityPolicy = makeDesktopContentSecurityPolicy(input);

      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            Electron.protocol.handle(input.scheme, async (request) => {
              if ("assetDirectory" in input) {
                return withContentSecurityPolicy(
                  await runPromise(serveDesktopAsset(request, input.assetDirectory)),
                  contentSecurityPolicy,
                );
              }
              return runPromise(
                proxyRequest(request, input.targetOrigin, contentSecurityPolicy).pipe(
                  Effect.catchTags({
                    ElectronProtocolFetchError: (error) => Effect.die(error.cause),
                  }),
                ),
              );
            });
          },
          catch: (cause) => new ElectronProtocolRegistrationError({ scheme: input.scheme, cause }),
        }).pipe(Effect.andThen(Ref.set(registered, true))),
        () =>
          Effect.try({
            try: () => Electron.protocol.unhandle(input.scheme),
            catch: (cause) =>
              new ElectronProtocolUnregistrationError({
                scheme: input.scheme,
                cause,
              }),
          }).pipe(Effect.andThen(Ref.set(registered, false)), Effect.orDie),
      );
    },
  );

  return ElectronProtocol.of({ registerDesktopProtocol });
});

export const layer = Layer.effect(ElectronProtocol, make);
