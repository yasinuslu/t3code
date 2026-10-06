/**
 * ClaudeProfileLogins - long-lived Claude tokens (`claude setup-token`) that a
 * code profile can bill instead of its home dir's own login.
 *
 * Settings name each login by id; the token lives only in the server secret
 * store, as `{ token, createdAt }` under `claude-login-<id>`. A session in a
 * profile whose active login is a token gets it as CLAUDE_CODE_OAUTH_TOKEN,
 * which Claude Code prefers over the credentials stored in its config dir.
 * Removing a login from settings removes its secret.
 *
 * @module provider/ClaudeProfileLogins
 */
import { CODE_PROFILE_HOME_LOGIN, type ServerSettings } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerSettingsModule from "../serverSettings.ts";

/** `claude setup-token` tokens; Anthropic documents a one-year lifetime. */
export const CLAUDE_LOGIN_TOKEN_PATTERN = /sk-ant-oat\d+-[A-Za-z0-9_-]{20,}/g;
const TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

const StoredLogin = Schema.Struct({ token: Schema.String, createdAt: Schema.String });
const decodeStoredLogin = Schema.decodeUnknownOption(Schema.fromJsonString(StoredLogin));
const encodeStoredLogin = Schema.encodeSync(Schema.fromJsonString(StoredLogin));

const secretName = (id: string) => `claude-login-${id}`;

export interface StoredClaudeLogin {
  readonly token: string;
  readonly createdAt: string;
  /** Estimated from `createdAt`; the token itself does not carry it. */
  readonly expiresAt: string | undefined;
}

/** Replace every token in `text`, so a terminal transcript never carries one. */
export const redactClaudeLoginTokens = (text: string) =>
  text.replace(CLAUDE_LOGIN_TOKEN_PATTERN, "sk-ant-…(saved)");

/** The last token `claude setup-token` printed, ignoring terminal escapes. */
export const findClaudeLoginToken = (transcript: string): string | undefined =>
  // oxlint-disable-next-line no-control-regex
  transcript
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .match(CLAUDE_LOGIN_TOKEN_PATTERN)
    ?.at(-1);

/**
 * The environment a session in `configDir` runs with. Outside a code profile
 * only the dir changes. Inside one, the profile's login wins: a token login
 * sets CLAUDE_CODE_OAUTH_TOKEN (over any inherited one), and the home login
 * removes an inherited token so the home dir's own credentials apply.
 */
export function claudeProfileEnvironment(
  base: NodeJS.ProcessEnv,
  input: { readonly configDir: string; readonly profiled: boolean; readonly token?: string },
): NodeJS.ProcessEnv {
  if (!input.profiled) return { ...base, CLAUDE_CONFIG_DIR: input.configDir };
  const { CLAUDE_CODE_OAUTH_TOKEN: _inherited, ...rest } = base;
  return {
    ...rest,
    CLAUDE_CONFIG_DIR: input.configDir,
    ...(input.token ? { CLAUDE_CODE_OAUTH_TOKEN: input.token } : {}),
  };
}

/** Login ids every profile references, home excluded. */
const referencedLoginIds = (settings: ServerSettings) =>
  new Set(
    Object.values(settings.codeProfiles).flatMap(
      (profile) => profile.claude?.logins?.map((login) => login.id) ?? [],
    ),
  );

export class ClaudeProfileLogins extends Context.Service<
  ClaudeProfileLogins,
  {
    /** `None` for an unknown id or an unreadable secret. */
    readonly read: (id: string) => Effect.Effect<Option.Option<StoredClaudeLogin>>;
    /** Store a token under a new id. */
    readonly save: (
      token: string,
    ) => Effect.Effect<{ readonly id: string }, ServerSecretStore.SecretStoreError>;
    readonly remove: (id: string) => Effect.Effect<void>;
  }
>()("t3/provider/ClaudeProfileLogins") {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const crypto = yield* Crypto.Crypto;

  const read = (id: string) =>
    id === CODE_PROFILE_HOME_LOGIN
      ? Effect.succeedNone
      : secrets.get(secretName(id)).pipe(
          Effect.map(Option.flatMap((bytes) => decodeStoredLogin(new TextDecoder().decode(bytes)))),
          Effect.map(
            Option.map((stored): StoredClaudeLogin => ({
              ...stored,
              expiresAt: Number.isFinite(Date.parse(stored.createdAt))
                ? DateTime.formatIso(
                    DateTime.makeUnsafe(Date.parse(stored.createdAt) + TOKEN_LIFETIME_MS),
                  )
                : undefined,
            })),
          ),
          // The error names the secret, never its contents.
          Effect.catch((error) =>
            Effect.logWarning("Could not read a Claude login token", {
              id,
              error: error.message,
            }).pipe(Effect.as(Option.none<StoredClaudeLogin>())),
          ),
        );

  const save = (token: string) =>
    Effect.gen(function* () {
      const id = (yield* crypto.randomUUIDv4.pipe(Effect.orDie)).replaceAll("-", "").slice(0, 16);
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* secrets.set(
        secretName(id),
        new TextEncoder().encode(encodeStoredLogin({ token: token.trim(), createdAt })),
      );
      return { id };
    });

  const remove = (id: string) =>
    secrets
      .remove(secretName(id))
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not remove a Claude login token", { id, error: error.message }),
        ),
      );

  return ClaudeProfileLogins.of({ read, save, remove });
});

/** Removes a login's token once no profile references its id anymore. */
const collectRemovedLogins = Effect.gen(function* () {
  const settings = yield* ServerSettingsModule.ServerSettingsService;
  const logins = yield* ClaudeProfileLogins;
  // Subscribe before reading, so no change between the two is missed.
  const changes = yield* settings.subscribeChanges;
  let previous = yield* settings.getSettings.pipe(
    Effect.map(referencedLoginIds),
    Effect.orElseSucceed(() => new Set<string>()),
  );
  yield* changes.pipe(
    Stream.runForEach((next) => {
      const current = referencedLoginIds(next);
      const removed = [...previous].filter((id) => !current.has(id));
      previous = current;
      return Effect.forEach(removed, logins.remove, { discard: true });
    }),
    Effect.forkScoped,
  );
});

export const layer = Layer.effectDiscard(collectRemovedLogins).pipe(
  Layer.provideMerge(Layer.effect(ClaudeProfileLogins, make)),
);
