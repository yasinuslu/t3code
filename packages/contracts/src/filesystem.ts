import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const FILESYSTEM_PATH_MAX_LENGTH = 512;

export const FilesystemBrowseInput = Schema.Struct({
  partialPath: TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
  cwd: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH))),
});
export type FilesystemBrowseInput = typeof FilesystemBrowseInput.Type;

export const FilesystemBrowseEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  fullPath: TrimmedNonEmptyString,
});
export type FilesystemBrowseEntry = typeof FilesystemBrowseEntry.Type;

export const FilesystemBrowseResult = Schema.Struct({
  parentPath: TrimmedNonEmptyString,
  entries: Schema.Array(FilesystemBrowseEntry),
});
export type FilesystemBrowseResult = typeof FilesystemBrowseResult.Type;

export const FilesystemBrowseFailure = Schema.Literals([
  "windows_path_unsupported",
  "current_project_required",
  "read_directory_failed",
]);
export type FilesystemBrowseFailure = typeof FilesystemBrowseFailure.Type;

function decodedFilesystemBrowseErrorMessage(props: object): string | undefined {
  if (!("message" in props)) return undefined;
  return typeof props.message === "string" ? props.message : undefined;
}

export class FilesystemBrowseError extends Schema.TaggedError<FilesystemBrowseError>()(
  "FilesystemBrowseError",
  {
    partialPath: Schema.optional(TrimmedNonEmptyString),
    cwd: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(FilesystemBrowseFailure),
    parentPath: Schema.optional(TrimmedNonEmptyString),
    platform: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // Structured diagnostics stay optional for rolling compatibility with legacy message-only
  // payloads, while new call sites must provide the request context and failure classification.
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: {
    readonly partialPath: string;
    readonly cwd?: string | undefined;
    readonly failure: FilesystemBrowseFailure;
    readonly parentPath?: string;
    readonly platform?: string;
    readonly cause?: unknown;
  }) {
    const cwd = props.cwd === undefined ? "" : ` from '${props.cwd}'`;
    super({
      ...props,
      message:
        decodedFilesystemBrowseErrorMessage(props) ??
        `Failed to browse filesystem path '${props.partialPath}'${cwd}.`,
    } as any);
  }
}

const FILESYSTEM_CODE_PROFILES_MAX_PATHS = 1_000;

/**
 * Code profiles are directories under `~/code` that hold their own
 * `<profile>-brain` knowledge base, e.g. `~/code/work/work-brain`. Clients use
 * them as default spaces for grouping projects.
 */
export const FilesystemCodeProfilesInput = Schema.Struct({
  /** Project workspace roots to place into a profile. */
  paths: Schema.Array(
    TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
  ).check(Schema.isMaxLength(FILESYSTEM_CODE_PROFILES_MAX_PATHS)),
});
export type FilesystemCodeProfilesInput = typeof FilesystemCodeProfilesInput.Type;

export const FilesystemCodeProfile = Schema.Struct({
  name: TrimmedNonEmptyString,
  /** Real path of the profile directory. */
  path: TrimmedNonEmptyString,
});
export type FilesystemCodeProfile = typeof FilesystemCodeProfile.Type;

export const FilesystemCodeProfilesResult = Schema.Struct({
  profiles: Schema.Array(FilesystemCodeProfile),
  /** One entry per input path, matched after resolving symlinks. */
  assignments: Schema.Array(
    Schema.Struct({
      path: TrimmedNonEmptyString,
      profile: Schema.NullOr(TrimmedNonEmptyString),
    }),
  ),
});
export type FilesystemCodeProfilesResult = typeof FilesystemCodeProfilesResult.Type;
