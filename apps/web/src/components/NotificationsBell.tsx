import type { UserNotification } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { BellIcon } from "lucide-react";
import { useState } from "react";

import { followNotificationLink } from "../pushNotifications";
import { formatInboxTime } from "../pushNotifications.logic";
import { notificationsEnvironment, usePrimaryNotifications } from "../state/notifications";
import { useAtomCommand } from "../state/use-atom-command";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "./ui/popover";

/** The unread count the bell shows, capped so the badge stays one short token. */
function unreadLabel(count: number): string {
  return count > 9 ? "9+" : String(count);
}

function InboxItem({
  notification,
  onOpen,
}: {
  readonly notification: UserNotification;
  readonly onOpen: (notification: UserNotification) => void;
}) {
  const unread = notification.readAt === undefined;
  // Taken when the inbox opens, which is when its items mount.
  const [nowMs] = useState(() => Date.now());
  return (
    <button
      type="button"
      data-notification-item=""
      className="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
      onClick={() => onOpen(notification)}
    >
      <span
        aria-label={unread ? "Okunmadı" : undefined}
        className={
          unread
            ? "mt-1.5 size-2 shrink-0 rounded-full bg-primary"
            : "mt-1.5 size-2 shrink-0 rounded-full"
        }
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span
            className={
              unread
                ? "min-w-0 flex-1 truncate font-medium text-sm"
                : "min-w-0 flex-1 truncate text-muted-foreground text-sm"
            }
          >
            {notification.title}
          </span>
          {notification.priority === "urgent" ? (
            <Badge size="sm" variant="error">
              Acil
            </Badge>
          ) : null}
          <span className="shrink-0 text-muted-foreground text-xs">
            {formatInboxTime(notification.createdAt, nowMs)}
          </span>
        </span>
        {notification.body ? (
          <span className="line-clamp-2 text-muted-foreground text-xs">{notification.body}</span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * The owner's inbox: messages agents and tasks sent through `notify`, newest first. Reads the
 * primary environment's notifications, so it renders nothing until that environment reports them.
 */
export function NotificationsBell() {
  const { environmentId, state } = usePrimaryNotifications();
  const markRead = useAtomCommand(notificationsEnvironment.markRead);
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!environmentId || !state) return null;

  const openNotification = (notification: UserNotification) => {
    if (notification.readAt === undefined) {
      void markRead({ environmentId, input: { ids: [notification.id] } });
    }
    if (notification.link) {
      setOpen(false);
      followNotificationLink(notification.link, router.history);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={
              state.unreadCount > 0 ? `Bildirimler, ${state.unreadCount} okunmamış` : "Bildirimler"
            }
            data-notifications-bell=""
          />
        }
      >
        <span className="relative flex">
          <BellIcon />
          {state.unreadCount > 0 ? (
            <span className="pointer-events-none absolute -top-2 left-full -ms-1">
              <Badge size="sm">{unreadLabel(state.unreadCount)}</Badge>
            </span>
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverPopup align="end" padding="none" width="md">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <PopoverTitle>Bildirimler</PopoverTitle>
            <Button
              size="xs"
              variant="ghost"
              disabled={state.unreadCount === 0}
              onClick={() => void markRead({ environmentId, input: {} })}
            >
              Hepsini okundu işaretle
            </Button>
          </div>
          {state.items.length === 0 ? (
            <p className="px-3 py-6 text-center text-muted-foreground text-sm">Bildirim yok</p>
          ) : (
            <div className="max-h-96 divide-y overflow-y-auto">
              {state.items.map((notification) => (
                <InboxItem
                  key={notification.id}
                  notification={notification}
                  onOpen={openNotification}
                />
              ))}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
