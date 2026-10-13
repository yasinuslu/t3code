import type {
  CodeProfile,
  CodeProfileAccountBalancing,
  CodeProfileBalancedAccount,
  ProviderInstanceId,
} from "@t3tools/contracts";

export function splitDirs(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((dir) => dir.trim())
    .filter((dir) => dir.length > 0);
}

/** The weight of "Normal": an account at it stores no `weight`. */
const NORMAL_WEIGHT = 50;

/**
 * Rebuild a profile with some fields changed. Every field not in `patch` is
 * carried over, `accountBalancing` included: the server replaces a profile
 * wholesale, so anything left out here is deleted from settings.
 */
export function profileWith(
  profile: CodeProfile,
  patch: {
    root?: string;
    configDir?: string;
    extra?: string[];
    accountBalancing?: CodeProfileAccountBalancing;
  },
): CodeProfile {
  const root = patch.root ?? profile.root;
  const configDir = patch.configDir ?? profile.claude?.configDir;
  const accountBalancing = patch.accountBalancing ?? profile.accountBalancing;
  return {
    root,
    // A profile written without Claude settings keeps none until a dir is set.
    ...(configDir === undefined
      ? {}
      : {
          claude: {
            configDir,
            extraConfigDirs: patch.extra ?? profile.claude?.extraConfigDirs ?? [],
          },
        }),
    // A profile that never touched balancing does not gain the key.
    ...(accountBalancing === undefined ? {} : { accountBalancing }),
  };
}

const NO_BALANCING: CodeProfileAccountBalancing = {
  enabled: false,
  accounts: [],
  includeManager: false,
};

function withBalancing(
  profile: CodeProfile,
  update: (balancing: CodeProfileAccountBalancing) => CodeProfileAccountBalancing,
): CodeProfile {
  return profileWith(profile, {
    accountBalancing: update(profile.accountBalancing ?? NO_BALANCING),
  });
}

export function setBalancingEnabled(profile: CodeProfile, enabled: boolean): CodeProfile {
  return withBalancing(profile, (balancing) => ({ ...balancing, enabled }));
}

export function setBalancingIncludeManager(
  profile: CodeProfile,
  includeManager: boolean,
): CodeProfile {
  return withBalancing(profile, (balancing) => ({ ...balancing, includeManager }));
}

function withAccounts(
  profile: CodeProfile,
  update: (accounts: ReadonlyArray<CodeProfileBalancedAccount>) => CodeProfileBalancedAccount[],
): CodeProfile {
  return withBalancing(profile, (balancing) => ({
    ...balancing,
    accounts: update(balancing.accounts),
  }));
}

/** Appends the instance; one already in the list stays where it is. */
export function addBalancedAccount(profile: CodeProfile, instanceId: ProviderInstanceId) {
  return withAccounts(profile, (accounts) =>
    accounts.some((account) => account.instanceId === instanceId)
      ? [...accounts]
      : [...accounts, { instanceId }],
  );
}

export function removeBalancedAccount(profile: CodeProfile, instanceId: ProviderInstanceId) {
  return withAccounts(profile, (accounts) =>
    accounts.filter((account) => account.instanceId !== instanceId),
  );
}

/** Moves an account one place toward the front (-1) or the back (1). */
export function moveBalancedAccount(
  profile: CodeProfile,
  instanceId: ProviderInstanceId,
  direction: -1 | 1,
) {
  return withAccounts(profile, (accounts) => {
    const from = accounts.findIndex((account) => account.instanceId === instanceId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= accounts.length) return [...accounts];
    const next = [...accounts];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    return next;
  });
}

function updateAccount(
  profile: CodeProfile,
  instanceId: ProviderInstanceId,
  update: (account: CodeProfileBalancedAccount) => CodeProfileBalancedAccount,
) {
  return withAccounts(profile, (accounts) =>
    accounts.map((account) => (account.instanceId === instanceId ? update(account) : account)),
  );
}

/** `undefined` clears the model, so the instance's default model is used. */
export function setBalancedAccountModel(
  profile: CodeProfile,
  instanceId: ProviderInstanceId,
  model: string | undefined,
) {
  return updateAccount(profile, instanceId, ({ model: _previous, ...rest }) =>
    model === undefined ? rest : { ...rest, model },
  );
}

/** Normal (50) is the default, so choosing it removes the stored weight. */
export function setBalancedAccountWeight(
  profile: CodeProfile,
  instanceId: ProviderInstanceId,
  weight: number,
) {
  return updateAccount(profile, instanceId, ({ weight: _previous, ...rest }) =>
    weight === NORMAL_WEIGHT ? rest : { ...rest, weight },
  );
}
