import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import { registerManagerShortcut } from "../../window/ManagerShortcut.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { SET_MANAGER_SHORTCUT_CHANNEL } from "../channels.ts";

const ManagerChord = Schema.NullOr(
  Schema.Struct({
    key: Schema.String.check(Schema.isMaxLength(16)),
    control: Schema.Boolean,
    alt: Schema.Boolean,
    meta: Schema.Boolean,
    shift: Schema.Boolean,
  }),
);

/** The renderer reports its `manager.toggle` chord; the main process takes it system-wide. */
export const installManagerShortcut = Effect.fn("desktop.ipc.installManagerShortcut")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const platform = yield* HostProcessPlatform;
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
