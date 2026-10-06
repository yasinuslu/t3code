/**
 * Adds a token login to a code profile through the provider sign-in flow:
 * either `claude setup-token` in a terminal, whose printed token is captured
 * into the secret store, or a pasted token. The token never reaches settings,
 * logs or the client: the terminal transcript is redacted before it is sent.
 *
 * Unlike an account sign-in, adding a login changes nothing for running
 * sessions, so the controller never stops them and never blocks new ones.
 *
 * @module provider/ClaudeProfileLoginAuth
 */
import {
  ProviderSetupError,
  type ProviderAuthMethod,
  type ProviderAuthResponse,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";

import type * as ServerSettingsModule from "../serverSettings.ts";
import type * as PtyAdapter from "../terminal/PtyAdapter.ts";
import {
  findClaudeLoginToken,
  redactClaudeLoginTokens,
  type ClaudeProfileLogins,
} from "./ClaudeProfileLogins.ts";
import * as ProviderAuthFlow from "./ProviderAuthFlow.ts";
import type { ProviderAuthController } from "./Services/ProviderAuthService.ts";

const isProviderSetupError = Schema.is(ProviderSetupError);
const SETUP_TOKEN = "setup-token";
const PASTE_TOKEN = "paste-token";
const MAX_TRANSCRIPT = 16_384;
const MAX_LOGIN_NAME = 80;
// Wide enough that the CLI prints the token on one line; the client's
// terminal wraps it for display.
const MIN_COLUMNS = 300;

/** `setup-token:<profile>` or `paste-token:<profile>`. */
export const claudeProfileLoginMethodId = (kind: "setup" | "paste", profile: string) =>
  `${kind === "setup" ? SETUP_TOKEN : PASTE_TOKEN}:${profile}`;

const parseMethodId = (methodId: string) => {
  const separator = methodId.indexOf(":");
  const kind = methodId.slice(0, separator);
  const profile = methodId.slice(separator + 1);
  return separator > 0 && (kind === SETUP_TOKEN || kind === PASTE_TOKEN) && profile
    ? { kind, profile }
    : undefined;
};

export const makeClaudeProfileLoginAuth = Effect.fn("makeClaudeProfileLoginAuth")(
  function* (options: {
    readonly instanceId: ProviderInstanceId;
    readonly settings: ServerSettingsModule.ServerSettingsService["Service"];
    readonly logins: ClaudeProfileLogins["Service"];
    readonly pty: Option.Option<PtyAdapter.PtyAdapter["Service"]>;
    /** The CLI command and args for `claude setup-token`, already resolved. */
    readonly setupTokenCommand: { readonly command: string; readonly args: ReadonlyArray<string> };
    readonly environment: NodeJS.ProcessEnv;
    readonly cwd: string;
  }) {
    const failure = (operation: string, detail: string, cause?: unknown) =>
      new ProviderSetupError({
        instanceId: options.instanceId,
        operation,
        detail,
        ...(cause === undefined ? {} : { cause }),
      });

    const methods = options.settings.getSettings.pipe(
      Effect.map((settings) =>
        Object.entries(settings.codeProfiles).flatMap(([profile, config]): ProviderAuthMethod[] =>
          config.claude === undefined || profile.length > 100
            ? []
            : [
                ...(Option.isSome(options.pty)
                  ? [
                      {
                        id: claudeProfileLoginMethodId("setup", profile),
                        name: `Run claude setup-token for ${profile}`,
                        description: "Sign in in the browser; T3 saves the printed token.",
                        type: "terminal" as const,
                      },
                    ]
                  : []),
                {
                  id: claudeProfileLoginMethodId("paste", profile),
                  name: `Paste a token for ${profile}`,
                  description: "A token printed by claude setup-token.",
                  type: "credentials" as const,
                },
              ],
        ),
      ),
      Effect.mapError((cause) => failure("methods", "Could not read the code profiles.", cause)),
    );

    /** Ask for the login's name, and the token when pasting. */
    const askCredentials = Effect.fnUntraced(function* (
      context: ProviderAuthFlow.ProviderAuthFlowContext,
      withToken: boolean,
    ) {
      const answer = yield* Deferred.make<Readonly<Record<string, string>>>();
      yield* context.setInteraction(
        {
          type: "credentials",
          id: withToken ? "login-token" : "login-name",
          fields: [
            { name: "name", label: "Login name", secret: false },
            ...(withToken ? [{ name: "token", label: "Token", secret: true }] : []),
          ],
        },
        (response: ProviderAuthResponse) =>
          response.type === "credentials"
            ? Deferred.succeed(answer, response.values).pipe(Effect.asVoid)
            : Effect.void,
      );
      const values = yield* Deferred.await(answer);
      // Let the response finish before this flow can end and interrupt it.
      yield* Effect.yieldNow;
      const name = values.name?.trim() ?? "";
      if (!name || name.length > MAX_LOGIN_NAME)
        return yield* failure("respond", "Give the login a name of up to 80 characters.");
      return { name, token: values.token };
    });

    /** Run `claude setup-token`, streaming a redacted transcript; return its token. */
    const runSetupToken = Effect.fnUntraced(function* (
      context: ProviderAuthFlow.ProviderAuthFlowContext,
    ) {
      if (Option.isNone(options.pty))
        return yield* failure("start", "A terminal is unavailable on this environment.");
      const exited = yield* Deferred.make<number>();
      const output = yield* Queue.unbounded<string>();
      const process = yield* options.pty.value
        .spawn({
          shell: options.setupTokenCommand.command,
          args: [...options.setupTokenCommand.args],
          cwd: options.cwd,
          cols: MIN_COLUMNS,
          rows: 24,
          env: options.environment,
        })
        .pipe(
          Effect.mapError((cause) =>
            failure("start", "Could not start claude setup-token.", cause),
          ),
        );
      const detachData = process.onData((data) => Queue.offerUnsafe(output, data));
      const detachExit = process.onExit(({ exitCode }) =>
        Deferred.doneUnsafe(exited, Effect.succeed(exitCode)),
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          detachData();
          detachExit();
          try {
            process.kill();
          } catch {
            /* setup-token may already have exited. */
          }
        }),
      );
      // The raw transcript stays here; the client gets it with tokens replaced,
      // holding back a trailing partial token until it is complete.
      let raw = "";
      let sent = "";
      let offset = 0;
      const publish = () =>
        Effect.gen(function* () {
          const visible = redactClaudeLoginTokens(raw.replace(/sk-ant-[A-Za-z0-9_-]*$/, ""));
          if (visible.startsWith(sent)) offset += visible.length - sent.length;
          else offset += visible.length;
          sent = visible;
          yield* context.setInteraction(
            {
              type: "terminal",
              id: "setup-token",
              output: visible.slice(-MAX_TRANSCRIPT),
              outputOffset: offset,
            },
            (response) =>
              response.type === "terminal"
                ? Effect.try({
                    try: () => {
                      if (response.size)
                        process.resize(
                          Math.max(response.size.cols, MIN_COLUMNS),
                          response.size.rows,
                        );
                      if (response.data) process.write(response.data);
                    },
                    catch: () => failure("respond", "The setup-token terminal has closed."),
                  })
                : Effect.void,
          );
        });
      yield* publish();
      yield* Queue.take(output).pipe(
        Effect.flatMap((data) => {
          raw = (raw + data).slice(-4 * MAX_TRANSCRIPT);
          return publish();
        }),
        Effect.forever,
        Effect.forkScoped,
      );
      const exitCode = yield* Deferred.await(exited);
      // Drain what arrived just before the exit.
      raw += (yield* Queue.takeAll(output)).join("");
      const token = findClaudeLoginToken(raw);
      if (exitCode !== 0 || token === undefined)
        return yield* failure(
          "start",
          token === undefined
            ? "claude setup-token finished without printing a token."
            : "claude setup-token did not finish successfully.",
        );
      return token;
    });

    const addLogin = Effect.fnUntraced(function* (profile: string, name: string, token: string) {
      const { id } = yield* options.logins
        .save(token)
        .pipe(Effect.mapError((cause) => failure("save", "Could not store the token.", cause)));
      yield* Effect.gen(function* () {
        const settings = yield* options.settings.getSettings;
        const current = settings.codeProfiles[profile];
        if (current?.claude === undefined)
          return yield* failure("save", `The code profile ${profile} no longer has a Claude dir.`);
        yield* options.settings.updateSettings({
          codeProfiles: {
            [profile]: {
              ...current,
              claude: {
                ...current.claude,
                logins: [...(current.claude.logins ?? []), { id, name }],
              },
            },
          },
        });
      }).pipe(
        Effect.mapError((cause) =>
          isProviderSetupError(cause)
            ? cause
            : failure("save", "Could not save the login to settings.", cause),
        ),
        Effect.tapError(() => options.logins.remove(id)),
      );
    });

    const authenticate = (methodId: string, context: ProviderAuthFlow.ProviderAuthFlowContext) =>
      Effect.gen(function* () {
        const method = parseMethodId(methodId);
        if (!method) return yield* failure("start", "Unknown login method.");
        const credentials = yield* askCredentials(context, method.kind === PASTE_TOKEN);
        const token =
          method.kind === PASTE_TOKEN
            ? findClaudeLoginToken(credentials.token ?? "")
            : yield* runSetupToken(context);
        if (token === undefined)
          return yield* failure("respond", "That is not a token from claude setup-token.");
        yield* context.verifying;
        yield* addLogin(method.profile, credentials.name, token);
      });

    const flow = yield* ProviderAuthFlow.make({
      instanceId: options.instanceId,
      credentialBinding: { owner: "t3", key: `claude-profile-logins:${options.instanceId}` },
      methods,
      authenticate,
      logout: Effect.fail(failure("logout", "Remove a login from its code profile instead.")),
      timeoutMs: 10 * 60_000,
    });

    // Only the flow itself: no credential binding, session admission or
    // stopping, since a new login applies to new sessions only.
    const controller: ProviderAuthController = {
      start: (owner, _stopSessions, methodId, returnUrl, callbackMode) =>
        flow.start(owner, Effect.void, methodId, returnUrl, callbackMode),
      complete: flow.complete,
      cancel: flow.cancel,
      ...(flow.respond ? { respond: flow.respond } : {}),
      logout: () => flow.logout(Effect.void),
      subscribe: flow.subscribe,
      ...(flow.refreshMethods ? { refreshMethods: flow.refreshMethods } : {}),
    };
    return controller;
  },
);
