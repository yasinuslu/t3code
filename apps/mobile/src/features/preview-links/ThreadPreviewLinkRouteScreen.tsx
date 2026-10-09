import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { previewLinkLabel } from "@t3tools/client-runtime/state/preview-links";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { LoadingStrip } from "../../components/LoadingStrip";
import { cn } from "../../lib/cn";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useThreadShell } from "../../state/entities";
import { refreshPreviewLinkStates, usePreviewLinkStates } from "../../state/preview-links";
import { presentPreviewLinkState } from "./threadPreviewLinkPresentation";

type ThreadPreviewLinkRouteScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly url: string;
}>;

/** A thread's preview, loaded in-app. Plain-HTTP tailnet hosts load too (ATS allows arbitrary loads). */
export function ThreadPreviewLinkRouteScreen({ route }: ThreadPreviewLinkRouteScreenProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const threadId = ThreadId.make(route.params.threadId);
  const url = route.params.url;
  const thread = useThreadShell(
    useMemo(() => scopeThreadRef(environmentId, threadId), [environmentId, threadId]),
  );
  const link = thread?.previewLinks?.find((candidate) => candidate.url === url);
  const title = link !== undefined ? previewLinkLabel(link) : url;

  const urls = useMemo(() => [url], [url]);
  const state = usePreviewLinkStates(environmentId, urls).get(url) ?? "unknown";
  const status = presentPreviewLinkState(state);

  const webViewRef = useRef<WebView<object>>(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [navigationState, setNavigationState] = useState({ canGoBack: false, canGoForward: false });

  // Opening wakes a stopped preview; refresh so the dot follows it up.
  useEffect(() => {
    refreshPreviewLinkStates(environmentId, [url]);
  }, [environmentId, url]);

  const close = useCallback(() => navigation.goBack(), [navigation]);

  // Android back walks the page history before leaving the preview.
  useEffect(() => {
    if (Platform.OS !== "android" || !navigationState.canGoBack) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      webViewRef.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [navigationState.canGoBack]);

  return (
    <View className="flex-1 bg-card">
      <View
        className="flex-row items-center gap-1 border-b border-border bg-card px-2 pb-2"
        style={{ paddingTop: insets.top + 6 }}
      >
        <ToolbarButton icon="xmark" label="Close preview" onPress={close} />
        <ToolbarButton
          icon="chevron.left"
          label="Back"
          disabled={!navigationState.canGoBack}
          onPress={() => webViewRef.current?.goBack()}
        />
        <ToolbarButton
          icon="chevron.right"
          label="Forward"
          disabled={!navigationState.canGoForward}
          onPress={() => webViewRef.current?.goForward()}
        />
        <View
          accessible
          accessibilityLabel={[title, status.label].filter((part) => part !== null).join(", ")}
          className="min-w-0 flex-1 flex-row items-center justify-center gap-1.5 px-1"
        >
          {status.dotClassName !== null ? (
            <View className={cn("h-2 w-2 shrink-0 rounded-full", status.dotClassName)} />
          ) : null}
          <Text className="shrink font-t3-bold text-sm text-foreground" numberOfLines={1}>
            {title}
          </Text>
        </View>
        <ToolbarButton
          icon="arrow.clockwise"
          label="Reload"
          disabled={status.removed}
          onPress={() => {
            refreshPreviewLinkStates(environmentId, [url]);
            webViewRef.current?.reload();
          }}
        />
        <ToolbarButton
          icon="safari"
          label="Open in browser"
          onPress={() => void tryOpenExternalUrl(url, "preview-link")}
        />
      </View>
      {loadProgress > 0 && loadProgress < 1 ? <LoadingStrip progress={loadProgress} /> : null}
      {loadError !== null ? (
        <View className="border-b border-border bg-card px-4 py-2">
          <Text className="text-xs font-t3-bold text-foreground">Preview failed to load</Text>
          <Text className="mt-0.5 text-xs leading-snug text-foreground-muted">{loadError}</Text>
        </View>
      ) : null}
      {status.removed ? (
        <View className="flex-1 items-center justify-center gap-1 px-8">
          <Text className="font-t3-bold text-base text-foreground">This preview was removed</Text>
          <Text className="text-center text-sm text-foreground-muted">
            Its host no longer serves it.
          </Text>
        </View>
      ) : (
        <WebView<object>
          ref={webViewRef}
          source={{ uri: url }}
          originWhitelist={["http://*", "https://*"]}
          mixedContentMode="always"
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          setSupportMultipleWindows={false}
          startInLoadingState
          onLoadProgress={(event) => setLoadProgress(event.nativeEvent.progress)}
          onLoadStart={() => {
            setLoadProgress(0.05);
            setLoadError(null);
          }}
          onLoadEnd={() => {
            setLoadProgress(0);
            refreshPreviewLinkStates(environmentId, [url]);
          }}
          onError={(event) => {
            setLoadProgress(0);
            setLoadError(event.nativeEvent.description || "The preview did not respond.");
          }}
          onHttpError={(event) => {
            setLoadError(`The preview answered HTTP ${event.nativeEvent.statusCode}.`);
          }}
          onNavigationStateChange={(event) =>
            setNavigationState((current) =>
              current.canGoBack === event.canGoBack && current.canGoForward === event.canGoForward
                ? current
                : { canGoBack: event.canGoBack, canGoForward: event.canGoForward },
            )
          }
          renderLoading={() => (
            <View className="absolute inset-0 items-center justify-center bg-card">
              <ActivityIndicator />
            </View>
          )}
          style={{ flex: 1, backgroundColor: "transparent" }}
        />
      )}
    </View>
  );
}

function ToolbarButton(props: {
  readonly icon: "xmark" | "chevron.left" | "chevron.right" | "arrow.clockwise" | "safari";
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled}
      hitSlop={4}
      onPress={props.onPress}
      className={cn(
        "size-9 items-center justify-center rounded-full active:bg-subtle",
        props.disabled && "opacity-35",
      )}
    >
      <SymbolView name={props.icon} size={17} tintColorClassName="accent-icon" type="monochrome" />
    </Pressable>
  );
}
