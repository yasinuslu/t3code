import {
  CODE_PROFILE_HOME_LOGIN,
  ProviderDriverKind,
  type CodeProfile,
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerProviderCodeProfile,
} from "@t3tools/contracts";
import { ChevronDownIcon, CopyIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CodeProfileLoginFlow } from "./CodeProfileLoginFlow";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { getProviderVersionLabel, PROVIDER_STATUS_STYLES } from "./providerStatus";

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");

/** A profile's account line, from the routing instance's last probe. */
export function codeProfileHeadline(status: ServerProviderCodeProfile | undefined): string {
  if (!status) return "Checking account";
  if (status.login && status.auth.status !== "unauthenticated" && status.status === "ready")
    return `Token login · ${status.login.name}`;
  if (status.auth.status === "authenticated") {
    const label = status.auth.label ?? status.auth.type;
    return label ? `Authenticated · ${label}` : "Authenticated";
  }
  if (status.auth.status === "unauthenticated") return "Not authenticated";
  return "Needs attention";
}

function splitDirs(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((dir) => dir.trim())
    .filter((dir) => dir.length > 0);
}

function profileWith(
  profile: CodeProfile,
  patch: { root?: string; configDir?: string; extra?: string[] },
): CodeProfile {
  const root = patch.root ?? profile.root;
  const configDir = patch.configDir ?? profile.claude?.configDir;
  // A profile written without Claude settings keeps none until a dir is set.
  if (configDir === undefined) return { root };
  return {
    root,
    claude: {
      ...profile.claude,
      configDir,
      extraConfigDirs: patch.extra ?? profile.claude?.extraConfigDirs ?? [],
    },
  };
}

/** `profile` with `activeLogin` set; `"home"` clears it. */
export function profileWithActiveLogin(profile: CodeProfile, loginId: string): CodeProfile {
  if (profile.claude === undefined) return profile;
  const { activeLogin: _previous, ...claude } = profile.claude;
  return {
    ...profile,
    claude: loginId === CODE_PROFILE_HOME_LOGIN ? claude : { ...claude, activeLogin: loginId },
  };
}

/** `profile` without the login `loginId`, back on the home login if it was active. */
export function profileWithoutLogin(profile: CodeProfile, loginId: string): CodeProfile {
  if (profile.claude === undefined) return profile;
  const next = {
    ...profile,
    claude: {
      ...profile.claude,
      logins: (profile.claude.logins ?? []).filter((login) => login.id !== loginId),
    },
  };
  return profile.claude.activeLogin === loginId
    ? profileWithActiveLogin(next, CODE_PROFILE_HOME_LOGIN)
    : next;
}

const activeLoginId = (profile: CodeProfile) => {
  const id = profile.claude?.activeLogin;
  return id && profile.claude?.logins?.some((login) => login.id === id)
    ? id
    : CODE_PROFILE_HOME_LOGIN;
};

const formatDay = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(Date.parse(iso));

/** Home or one of the profile's token logins; applies to new sessions. */
export function CodeProfileLoginPicker({
  name,
  profile,
  disabled,
  onSave,
  compact = false,
}: {
  readonly name: string;
  readonly profile: CodeProfile;
  readonly disabled: boolean;
  readonly onSave: (name: string, profile: CodeProfile) => void;
  readonly compact?: boolean;
}) {
  const logins = profile.claude?.logins ?? [];
  const active = activeLoginId(profile);
  const label = (id: string) =>
    id === CODE_PROFILE_HOME_LOGIN
      ? "Home login"
      : (logins.find((login) => login.id === id)?.name ?? "Home login");
  const choose = (value: unknown) => {
    if (typeof value === "string" && value !== active)
      onSave(name, profileWithActiveLogin(profile, value));
  };
  const isDisabled = disabled || profile.claude === undefined;
  // A list row has no room for a full select; a small menu button fits.
  if (compact) {
    return (
      <Menu>
        <MenuTrigger
          render={<Button size="xs" variant="ghost-muted" />}
          disabled={isDisabled}
          aria-label={`Login for ${name}`}
          className="max-w-28"
        >
          <span className="truncate">{label(active)}</span>
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuRadioGroup value={active} onValueChange={choose}>
            <MenuRadioItem value={CODE_PROFILE_HOME_LOGIN} closeOnClick>
              Home login
            </MenuRadioItem>
            {logins.map((login) => (
              <MenuRadioItem key={login.id} value={login.id} closeOnClick>
                {login.name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
    );
  }
  return (
    <Select value={active} disabled={isDisabled} onValueChange={choose}>
      <SelectTrigger size="xs" aria-label={`Login for ${name}`}>
        <SelectValue>{label(active)}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value={CODE_PROFILE_HOME_LOGIN}>Home login</SelectItem>
        {logins.map((login) => (
          <SelectItem key={login.id} value={login.id}>
            {login.name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function StatusDot({ status }: { readonly status: ServerProviderCodeProfile | undefined }) {
  const key = status?.status;
  if (key !== "warning" && key !== "error") return null;
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", PROVIDER_STATUS_STYLES[key].dot)}
      aria-hidden
    />
  );
}

export function CodeProfileListRow({
  name,
  profile,
  status,
  version,
  selected,
  readOnly,
  onSelect,
  onSave,
}: {
  readonly name: string;
  readonly profile: CodeProfile;
  readonly status: ServerProviderCodeProfile | undefined;
  readonly version: string | null;
  readonly selected: boolean;
  readonly readOnly: boolean;
  readonly onSelect: () => void;
  readonly onSave: (name: string, profile: CodeProfile) => void;
}) {
  const versionLabel = getProviderVersionLabel(version);
  const home = profile.claude?.configDir;
  return (
    <div
      data-slot="settings-row"
      data-code-profile={name}
      className={cn(
        "group flex min-h-18 items-center gap-3 py-3 pr-3 pl-7 transition-colors sm:pr-4 sm:pl-8",
        selected ? "bg-muted/45" : "hover:bg-muted/25",
      )}
    >
      <div className="pointer-events-none relative flex min-w-0 flex-1 items-start gap-3 rounded-md text-left">
        <button
          type="button"
          className="pointer-events-auto absolute inset-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onSelect}
          aria-label={`Select code profile ${name}`}
          aria-pressed={selected}
        />
        <ProviderInstanceIcon
          driverKind={CLAUDE_DRIVER}
          displayName={name}
          className="size-5"
          iconClassName="size-4 text-foreground/80"
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
            <Badge variant="outline" size="sm" className="shrink-0">
              profile
            </Badge>
            {versionLabel ? (
              <code className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">
                {versionLabel}
              </code>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs leading-normal text-muted-foreground/80">
            <StatusDot status={status} />
            <span className="line-clamp-1 [overflow-wrap:anywhere]">
              {codeProfileHeadline(status)}
            </span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-2xs text-muted-foreground/70">
            {profile.root}
          </span>
          {/* The home dir and the login it bills, side by side. */}
          <span className="mt-1.5 flex min-w-0 items-center gap-2">
            {/* Truncated from the start, so the dir's own name stays visible. */}
            <span className="min-w-0 flex-1 truncate text-left font-mono text-2xs text-muted-foreground/70 [direction:rtl]">
              <bdi>{home ?? "no home dir"}</bdi>
            </span>
            <span className="pointer-events-auto relative shrink-0">
              <CodeProfileLoginPicker
                name={name}
                profile={profile}
                disabled={readOnly}
                onSave={onSave}
                compact
              />
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

export function AddCodeProfileListRow({
  selected,
  disabled,
  onSelect,
}: {
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <div className={cn("py-1.5 pr-3 pl-7 sm:pr-4 sm:pl-8", selected && "bg-muted/45")}>
      <Button size="xs" variant="ghost-muted" disabled={disabled} onClick={onSelect}>
        <PlusIcon />
        Add code profile
      </Button>
    </div>
  );
}

function LoginCommand({ configDir }: { readonly configDir: string }) {
  const command = `CLAUDE_CONFIG_DIR=${configDir} claude auth login`;
  const { copyToClipboard } = useCopyToClipboard<undefined>({
    onCopy: () => toastManager.add({ type: "success", title: "Login command copied" }),
  });
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-md border border-border/70 bg-muted/40 py-0.5 pr-0.5 pl-2">
      <code className="min-w-0 flex-1 truncate font-mono text-2xs text-foreground">{command}</code>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost-muted"
              className="shrink-0"
              onClick={() => copyToClipboard(command, undefined)}
              aria-label="Copy login command"
            >
              <CopyIcon className="size-3" />
            </Button>
          }
        />
        <TooltipPopup side="top">Copy command</TooltipPopup>
      </Tooltip>
    </div>
  );
}

/**
 * Editor for one code profile, or a draft profile when `name` is undefined.
 * Root and Claude config dir are required; an edit that clears either is not saved.
 */
export function CodeProfileEditor({
  name,
  profile,
  status,
  version,
  existingNames,
  readOnly,
  isRefreshing,
  onSave,
  onDelete,
  onRefresh,
  environmentId,
  instanceId,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly name: string | undefined;
  readonly profile: CodeProfile | undefined;
  readonly status: ServerProviderCodeProfile | undefined;
  readonly version: string | null;
  readonly existingNames: ReadonlyArray<string>;
  readonly readOnly: boolean;
  readonly isRefreshing: boolean;
  readonly onSave: (name: string, profile: CodeProfile) => void;
  readonly onDelete: (name: string) => void;
  readonly onRefresh: () => void;
}) {
  const [draft, setDraft] = useState({ name: "", root: "", configDir: "", extra: "" });
  const isNew = name === undefined || profile === undefined;
  const versionLabel = getProviderVersionLabel(version);
  const icon = (
    <ProviderInstanceIcon
      driverKind={CLAUDE_DRIVER}
      displayName={name ?? "New profile"}
      className="size-5"
      iconClassName="size-4 text-foreground/80"
    />
  );

  if (isNew) {
    const draftName = draft.name.trim();
    const nameTaken = existingNames.includes(draftName);
    const canAdd =
      !readOnly &&
      draftName.length > 0 &&
      !nameTaken &&
      draft.root.trim().length > 0 &&
      draft.configDir.trim().length > 0;
    const field = (key: keyof typeof draft, title: string, placeholder: string) => (
      <SettingsRow
        title={title}
        control={
          <Input
            size="sm"
            className="min-w-0 flex-1 @min-[32rem]/settings-row:w-72"
            value={draft[key]}
            placeholder={placeholder}
            spellCheck={false}
            disabled={readOnly}
            aria-label={title}
            onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
          />
        }
      />
    );
    return (
      <SettingsSection title="New code profile" icon={icon}>
        {field("name", "Name", "work")}
        {nameTaken ? (
          <p className="px-4 pb-2 text-xs text-destructive-foreground">
            A profile with this name exists.
          </p>
        ) : null}
        {field("root", "Root folder", "~/code/work")}
        {field("configDir", "Claude config dir", "~/code/work/.claude")}
        {field("extra", "Extra config dirs", "Optional, comma separated")}
        <div className="flex justify-end px-4 py-3">
          <Button
            size="sm"
            disabled={!canAdd}
            onClick={() =>
              onSave(draftName, {
                root: draft.root.trim(),
                claude: {
                  configDir: draft.configDir.trim(),
                  extraConfigDirs: splitDirs(draft.extra),
                },
              })
            }
          >
            Add profile
          </Button>
        </div>
      </SettingsSection>
    );
  }

  const email = status?.auth.status === "authenticated" ? status.auth.email : undefined;
  const configDir = profile.claude?.configDir ?? "";
  const commitRequired = (key: "root" | "configDir") => (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      toastManager.add({
        type: "error",
        title: key === "root" ? "Root folder is required" : "Claude config dir is required",
      });
      return;
    }
    onSave(name, profileWith(profile, { [key]: trimmed }));
  };

  const logins = profile.claude?.logins ?? [];
  const saved = new Map((status?.savedLogins ?? []).map((login) => [login.id, login]));
  return (
    <>
      <SettingsSection
        title={name}
        icon={icon}
        headerAction={
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant="outline" size="sm" className="shrink-0">
              profile
            </Badge>
            {versionLabel ? (
              <code className="text-xs text-muted-foreground">{versionLabel}</code>
            ) : null}
            <Button
              type="button"
              size="icon-xs"
              variant="ghost-muted"
              disabled={isRefreshing}
              onClick={onRefresh}
              aria-label={`Refresh ${name} account`}
            >
              <RefreshIcon refreshing={isRefreshing} />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost-destructive"
              disabled={readOnly}
              onClick={() => onDelete(name)}
              aria-label={`Delete code profile ${name}`}
            >
              <Trash2Icon />
            </Button>
          </div>
        }
      >
        <SettingsRow
          title="Account"
          status={
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              <StatusDot status={status} />
              {email ? (
                <>
                  <span>Authenticated as</span>
                  <RedactedSensitiveText
                    value={email}
                    ariaLabel="Toggle account email visibility"
                    revealTooltip="Click to reveal email"
                    hideTooltip="Click to hide email"
                    className="max-w-full truncate"
                  />
                  {status?.auth.label ? <span>· {status.auth.label}</span> : null}
                </>
              ) : (
                <span>{codeProfileHeadline(status)}</span>
              )}
              {status?.message ? (
                <span className="min-w-0 [overflow-wrap:anywhere]">· {status.message}</span>
              ) : null}
            </div>
          }
        >
          {status?.auth.status === "unauthenticated" && configDir ? (
            <div className="pb-2">
              <LoginCommand configDir={status.configDir ?? configDir} />
            </div>
          ) : null}
        </SettingsRow>
        <div
          inert={readOnly}
          aria-disabled={readOnly || undefined}
          className={readOnly ? "opacity-50 select-none" : undefined}
        >
          <SettingsRow
            title="Root folder"
            description="Threads in this folder, and in worktrees of its repositories, use this profile."
            control={
              <DraftInput
                size="sm"
                className="min-w-0 flex-1 @min-[32rem]/settings-row:w-72"
                value={profile.root}
                onCommit={commitRequired("root")}
                spellCheck={false}
                aria-label="Root folder"
              />
            }
          />
          <SettingsRow
            title="Claude config dir"
            description="CLAUDE_CONFIG_DIR for this profile's sessions."
            control={
              <DraftInput
                size="sm"
                className="min-w-0 flex-1 @min-[32rem]/settings-row:w-72"
                value={configDir}
                onCommit={commitRequired("configDir")}
                spellCheck={false}
                aria-label="Claude config dir"
              />
            }
          />
          <SettingsRow
            title="Extra config dirs"
            description="Other logins of this profile, kept when a session already uses one. Comma separated."
            control={
              <DraftInput
                size="sm"
                className="min-w-0 flex-1 @min-[32rem]/settings-row:w-72"
                value={(profile.claude?.extraConfigDirs ?? []).join(", ")}
                onCommit={(value) =>
                  onSave(name, profileWith(profile, { extra: splitDirs(value) }))
                }
                placeholder="None"
                spellCheck={false}
                aria-label="Extra config dirs"
              />
            }
          />
        </div>
      </SettingsSection>
      {profile.claude ? (
        <SettingsSection title="Logins">
          <SettingsRow
            title="Active login"
            description="The account this profile's new sessions bill. The home dir keeps its settings, plugins, skills, memory and history either way."
            control={
              <CodeProfileLoginPicker
                name={name}
                profile={profile}
                disabled={readOnly}
                onSave={onSave}
              />
            }
          />
          <SettingsRow
            title="Home login"
            description={`The credentials ${configDir} holds itself, from claude auth login.`}
          />
          {logins.map((login) => {
            const token = saved.get(login.id);
            return (
              <SettingsRow
                key={login.id}
                title={login.name}
                description={
                  token?.missing
                    ? "Token missing on this machine. Remove this login and add it again."
                    : token?.expiresAt
                      ? `Token login. Expires around ${formatDay(token.expiresAt)}.`
                      : "Token login."
                }
                control={
                  <Button
                    size="icon-xs"
                    variant="ghost-destructive"
                    disabled={readOnly}
                    aria-label={`Remove login ${login.name}`}
                    onClick={() => onSave(name, profileWithoutLogin(profile, login.id))}
                  >
                    <Trash2Icon />
                  </Button>
                }
              />
            );
          })}
          <SettingsRow
            title="Add a token login"
            description="Bill another Claude account in this profile's folders. Tokens from claude setup-token can't use Remote Control or claude.ai connectors (local MCP servers still work) and expire after a year."
          >
            <div className="pb-2">
              <CodeProfileLoginFlow
                environmentId={environmentId}
                instanceId={instanceId}
                profile={name}
                readOnly={readOnly}
              />
            </div>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </>
  );
}
