import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

/** Menu action the renderer maps to opening or closing the brainstorm popup. */
export const BRAINSTORM_TOGGLE_ACTION = "brainstorm.toggle";

let registeredAccelerator: string | null = null;

/**
 * Registers the brainstorm shortcut system-wide, so it brings the window
 * forward and toggles the popup from any app. The renderer passes the
 * accelerator of its (rebindable) keybinding, or null to release it. Returns
 * whether the shortcut is now registered; another app holding it is not an
 * error, the in-app binding still works.
 */
export const setBrainstormShortcut = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_BRAINSTORM_SHORTCUT_CHANNEL,
  payload: Schema.NullOr(Schema.String),
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.brainstorm.setShortcut")(function* (accelerator) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    if (accelerator === registeredAccelerator && accelerator !== null) {
      return Electron.globalShortcut.isRegistered(accelerator);
    }
    if (registeredAccelerator !== null) {
      Electron.globalShortcut.unregister(registeredAccelerator);
      registeredAccelerator = null;
    }
    if (accelerator === null) return false;
    const services = yield* Effect.context<never>();
    const toggle = () => {
      void Effect.runPromiseWith(services)(
        desktopWindow
          .dispatchMenuAction(BRAINSTORM_TOGGLE_ACTION, { reveal: true })
          .pipe(Effect.ignoreCause({ log: true })),
      );
    };
    const registered = yield* Effect.sync(() => {
      try {
        return Electron.globalShortcut.register(accelerator, toggle);
      } catch {
        return false;
      }
    });
    if (registered) registeredAccelerator = accelerator;
    return registered;
  }),
});
