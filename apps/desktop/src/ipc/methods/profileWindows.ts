import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { OPEN_PROFILE_WINDOW_CHANNEL, REPORT_WINDOW_PROFILE_CHANNEL } from "../channels.ts";

const ProfileName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));

/**
 * Each renderer reports the profile it is locked to and the code profiles its
 * server knows; the Window menu offers one window per profile from that list.
 */
export const reportWindowProfile = DesktopIpc.makeIpcMethod({
  channel: REPORT_WINDOW_PROFILE_CHANNEL,
  payload: Schema.Struct({
    lock: Schema.NullOr(ProfileName),
    profiles: Schema.Array(ProfileName).check(Schema.isMaxLength(32)),
  }),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.reportWindowProfile")(function* ({ lock, profiles }, event) {
    const sender = event === undefined ? undefined : Electron.webContents.fromId(event.sender.id);
    const window = sender ? Electron.BrowserWindow.fromWebContents(sender) : null;
    if (window === null) return;
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.reportRendererProfile({ window, lock, profiles });
  }),
});

export const openProfileWindow = DesktopIpc.makeIpcMethod({
  channel: OPEN_PROFILE_WINDOW_CHANNEL,
  payload: ProfileName,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.openProfileWindow")(function* (profile) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.openProfileWindow(profile);
  }),
});
