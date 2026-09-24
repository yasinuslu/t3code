import { Platform, Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { cn } from "../../../lib/cn";
import type { GitTargetRepositoryOption } from "../../../state/use-selected-thread-git-target";

/**
 * Compact horizontal picker between a thread's root repository and its
 * initialized submodules. Every git RPC already resolves its repo from
 * `cwd`, so selecting an option here is just choosing which absolute path
 * downstream commit/push/PR/review actions target. Renders nothing when
 * there is nothing to pick between (no submodules).
 */
export function GitTargetRepositoryPicker(props: {
  readonly options: ReadonlyArray<GitTargetRepositoryOption>;
  readonly selectedPath: string | null;
  readonly onSelect: (path: string | null) => void;
}) {
  if (props.options.length <= 1) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}
    >
      {props.options.map((option) => {
        const active = option.path === props.selectedPath;
        return (
          <Pressable
            key={option.path ?? "__root__"}
            accessibilityRole="button"
            accessibilityLabel={option.path ?? "Root repository"}
            accessibilityState={{ selected: active }}
            onPress={() => props.onSelect(option.path)}
            className={cn(
              "min-h-9 flex-row items-center gap-1.5 rounded-full border px-3.5 py-1.5",
              active
                ? "border-secondary-border bg-secondary"
                : Platform.OS === "android"
                  ? "border-transparent bg-subtle active:bg-subtle-strong"
                  : "border-border bg-card",
            )}
          >
            {option.hasChanges ? <View className="size-1.5 rounded-full bg-amber-500" /> : null}
            <Text
              numberOfLines={1}
              className={cn(
                "max-w-[160px] text-xs font-t3-medium",
                active ? "text-secondary-foreground" : "text-foreground-muted",
              )}
            >
              {option.path ?? "Root"}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
