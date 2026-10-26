// @effect-diagnostics nodeBuiltinImport:off - small sync store helper.
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { createDeterministicAttachmentId } from "../../../attachmentStore.ts";
import * as ServerConfig from "../../../config.ts";
import { unavailable } from "../../threadAccess.ts";

export const MAX_STORED_FILE_BYTES = 16 * 1024 * 1024;

export const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

/**
 * Copies a file an agent made into T3 storage and returns its attachment id, so it outlives
 * the worktree or /tmp it came from. The same bytes on the same thread keep one copy.
 *
 * Images are stored by extension (`<id>.png`). Other files carry their type in the id
 * (`<id>-html` stored as `<id>-html.html`), which is what lets the asset server answer
 * them inline: an HTML page is served sandboxed.
 */
export const storeThreadFile = Effect.fn("mcp.storeThreadFile")(function* (input: {
  readonly threadId: string;
  readonly bytes: Uint8Array;
  /** Lowercase, with the dot: `.png`, `.html`. */
  readonly extension: string;
  readonly generic?: boolean;
}) {
  if (input.bytes.byteLength > MAX_STORED_FILE_BYTES) {
    return yield* invalid("A stored file can be at most 16 MB.");
  }
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const hash = NodeCrypto.createHash("sha256").update(input.bytes).digest("hex");
  const base = createDeterministicAttachmentId(input.threadId, hash);
  if (base === null) return yield* unavailable();
  const attachmentId = input.generic ? `${base}-${input.extension.slice(1)}` : base;
  const target = path.join(config.attachmentsDir, `${attachmentId}${input.extension}`);
  if (!(yield* fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false)))) {
    yield* fileSystem.writeFile(target, input.bytes).pipe(Effect.mapError(unavailable));
  }
  return attachmentId;
});

/** Reads an image an agent points at by absolute path and stores it. */
export const storeImageFile = Effect.fn("mcp.storeImageFile")(function* (
  threadId: string,
  imagePath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const bytes = yield* fileSystem
    .readFile(imagePath)
    .pipe(Effect.mapError(() => invalid(`Could not read ${imagePath}.`)));
  const extension = path.extname(imagePath).toLowerCase().replace(".jpeg", ".jpg");
  return yield* storeThreadFile({ threadId, bytes, extension });
});
