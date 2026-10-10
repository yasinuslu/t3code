import { previewLinkLabel } from "@t3tools/client-runtime/state/preview-links";
import type { EnvironmentId, ThreadId, ThreadPreviewLink } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { ControlPillMenu } from "../../components/ControlPillMenu";
import { cn } from "../../lib/cn";
import { usePreviewLinkStates } from "../../state/preview-links";
import { presentThreadPreviewChip, previewLinkMenuActions } from "./threadPreviewLinkPresentation";
import { usePreviewLinkActions } from "./usePreviewLinkActions";

/**
 * A thread's preview links as one chip: the newest link's label, "+N" for the
 * rest, and a status dot. Mounted only for threads that have links, so only
 * those subscribe to preview status.
 *
 * One link: tap opens it, long-press offers open / open externally / copy /
 * remove. Several: tap lists them, each with the same actions.
 */
export function ThreadPreviewLinkChip(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly links: ReadonlyArray<ThreadPreviewLink>;
  /** `row` sits in a thread list row; `capsule` in the thread screen's floating capsule. */
  readonly variant: "row" | "capsule";
  readonly mutedTextClassName?: string;
  readonly mutedIconTintClassName?: string;
}) {
  const urls = useMemo(() => props.links.map((link) => link.url), [props.links]);
  const states = usePreviewLinkStates(props.environmentId, urls);
  const chip = useMemo(
    () => presentThreadPreviewChip(props.links, states, previewLinkLabel),
    [props.links, states],
  );
  const actions = useMemo(
    () => previewLinkMenuActions(props.links, states, previewLinkLabel),
    [props.links, states],
  );
  const { open, handleMenuEvent } = usePreviewLinkActions(props.environmentId, props.threadId);
  const handleMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) =>
      handleMenuEvent(nativeEvent.event, props.links, states),
    [handleMenuEvent, props.links, states],
  );
  const single = props.links.length === 1;
  const handlePress = useCallback(() => {
    if (chip !== null && single) open(chip.link, chip.state);
  }, [chip, open, single]);

  if (chip === null) return null;

  const row = props.variant === "row";
  const removed = chip.status.removed;
  return (
    <ControlPillMenu
      actions={actions}
      onPressAction={handleMenuAction}
      shouldOpenOnLongPress={single}
      title={single ? chip.label : "Previews"}
    >
      {/* Always a Pressable, so a tap here never reaches the enclosing row. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={chip.accessibilityLabel}
        accessibilityHint={
          single ? "Opens the preview. Long press for more actions" : "Lists this thread's previews"
        }
        hitSlop={row ? 6 : undefined}
        onPress={handlePress}
        className={cn(
          "flex-row items-center active:opacity-70",
          row ? "max-w-32 gap-1" : "h-11 max-w-48 gap-1.5 px-3",
          removed && "opacity-50",
        )}
      >
        <SymbolView
          name="globe"
          size={row ? 12 : 13}
          tintColorClassName={
            row ? (props.mutedIconTintClassName ?? "accent-icon-muted") : "accent-foreground-muted"
          }
        />
        <Text
          className={cn(
            "shrink text-xs",
            row ? props.mutedTextClassName : "font-t3-medium text-foreground",
            removed && "line-through",
          )}
          numberOfLines={1}
        >
          {removed ? `${chip.label} (removed)` : chip.label}
        </Text>
        {chip.countLabel !== null ? (
          <Text
            className={cn(
              "text-xs tabular-nums",
              row ? props.mutedTextClassName : "text-foreground-muted",
            )}
          >
            {chip.countLabel}
          </Text>
        ) : null}
        {chip.status.dotClassName !== null ? (
          <View className={cn("h-1.5 w-1.5 shrink-0 rounded-full", chip.status.dotClassName)} />
        ) : null}
      </Pressable>
    </ControlPillMenu>
  );
}
