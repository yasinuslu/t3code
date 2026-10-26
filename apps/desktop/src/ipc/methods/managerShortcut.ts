import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { registerManagerShortcut } from "../../window/ManagerShortcut.ts";
import { forgetShellChordsOf, setShellChords } from "../../window/ShellChords.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { SET_MANAGER_SHORTCUT_CHANNEL, SET_SHELL_CHORDS_CHANNEL } from "../channels.ts";

const ManagerChord = Schema.NullOr(
  Schema.Struct({
    key: Schema.String.check(Schema.isMaxLength(16)),
    control: Schema.Boolean,
    alt: Schema.Boolean,
    meta: Schema.Boolean,
    shift: Schema.Boolean,
  }),
);

const ShellChords = Schema.Array(
  Schema.Struct({
    command: Schema.String.check(Schema.isMaxLength(48)),
    key: Schema.String.check(Schema.isMaxLength(16)),
    control: Schema.Boolean,
    alt: Schema.Boolean,
    meta: Schema.Boolean,
    shift: Schema.Boolean,
  }),
).check(Schema.isMaxLength(256));

/**
 * The renderer reports the chords the shell acts on below the page (profile windows, menu
 * Settings and zoom, Grow's keys over a preview), resolved from its keybindings.
 */
/** The renderers that already have a cleanup on their close, so a repeat report adds none. */
const trackedShellSenders = new Set<number>();

export const installShellChords = Effect.fn("desktop.ipc.installShellChords")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SET_SHELL_CHORDS_CHANNEL,
      payload: ShellChords,
      result: Schema.Void,
      handler: (chords, event) =>
        Effect.sync(() => {
          const sender =
            event === undefined ? undefined : Electron.webContents.fromId(event.sender.id);
          if (!sender) return setShellChords(chords);
          const windowId = sender.id;
          setShellChords(chords, windowId);
          if (!trackedShellSenders.has(windowId)) {
            trackedShellSenders.add(windowId);
            sender.once("destroyed", () => {
              trackedShellSenders.delete(windowId);
              forgetShellChordsOf(windowId);
            });
          }
        }),
    }),
  );
});

/** The renderer reports its `manager.toggle` chord; the main process takes it system-wide. */
export const installManagerShortcut = Effect.fn("desktop.ipc.installManagerShortcut")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const platform = yield* HostProcess.Platform;
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SET_MANAGER_SHORTCUT_CHANNEL,
      payload: ManagerChord,
      result: Schema.Boolean,
      handler: (chord, event) =>
        Effect.sync(() => {
          const sender =
            event === undefined ? undefined : Electron.webContents.fromId(event.sender.id);
          const window = sender ? Electron.BrowserWindow.fromWebContents(sender) : null;
          return registerManagerShortcut(chord, window, platform);
        }),
    }),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => registerManagerShortcut(null, null, platform)),
  );
});
