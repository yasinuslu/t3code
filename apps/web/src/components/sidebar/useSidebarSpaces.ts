import type { ScopedProjectRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { useForkFeature } from "../../forkFeatures";
import {
  ALL_SPACE_ID,
  isInSpace,
  type Space,
  type SpaceRoute,
  useActiveSpaceId,
  useProjectSpaceResolver,
  useSpaceStore,
} from "../../spaceStore";

const NO_SPACES: ReadonlyArray<Space> = [];
import type { ThreadRouteTarget } from "../../threadRoutes";
import { requestManagerShown, useManagerViewStore } from "../../managerViewStore";

interface SpaceProjectGroup {
  readonly projectKey: string;
  readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
}

interface SpaceThread {
  readonly environmentId: string;
  readonly id: string;
  readonly projectId: string;
  readonly archivedAt: string | null;
}

function memberKeysOf(group: SpaceProjectGroup): ReadonlyArray<string> {
  return group.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`);
}

/**
 * Wires the sidebar to spaces: filters project groups to the active space,
 * remembers each space's last thread and project filter, restores them on
 * switch, and follows the route into another space when a thread outside the
 * active one is opened (from search, a notification, or a link).
 */
export function useSidebarSpaces<TGroup extends SpaceProjectGroup>(input: {
  readonly projectGroups: ReadonlyArray<TGroup>;
  readonly threads: ReadonlyArray<SpaceThread>;
  readonly routeTarget: ThreadRouteTarget | null;
  readonly routeDraftProjectKey: string | null;
  readonly projectScopeKeys: readonly string[];
  readonly setProjectScopeKeys: (projectKeys: readonly string[]) => void;
}) {
  const { projectGroups, threads, routeTarget, routeDraftProjectKey, projectScopeKeys } = input;
  const { setProjectScopeKeys } = input;
  const router = useRouter();
  const spacesOn = useForkFeature("spaces");
  const activeSpaceId = useActiveSpaceId();
  const storedSpaces = useSpaceStore((store) => store.spaces);
  const spaces = spacesOn ? storedSpaces : NO_SPACES;
  const resolveSpace = useProjectSpaceResolver();

  const groupSpaces = (group: SpaceProjectGroup) => resolveSpace(memberKeysOf(group));
  // A project resolves through its whole group, so a thread and the group
  // that lists it always agree on the space.
  const memberKeysByProjectKey = new Map<string, ReadonlyArray<string>>();
  for (const group of projectGroups) {
    const memberKeys = memberKeysOf(group);
    for (const key of memberKeys) memberKeysByProjectKey.set(key, memberKeys);
  }
  const projectSpaces = (projectKey: string) =>
    resolveSpace(memberKeysByProjectKey.get(projectKey) ?? [projectKey]);
  const spaceProjectGroups =
    activeSpaceId === ALL_SPACE_ID
      ? projectGroups
      : projectGroups.filter((group) => isInSpace(groupSpaces(group), activeSpaceId));
  const threadProjectKeyByThreadKey = new Map(
    threads.map(
      (thread) =>
        [
          `${thread.environmentId}:${thread.id}`,
          `${thread.environmentId}:${thread.projectId}`,
        ] as const,
    ),
  );

  const routeProjectKey =
    routeTarget?.kind === "server"
      ? (threadProjectKeyByThreadKey.get(
          `${routeTarget.threadRef.environmentId}:${routeTarget.threadRef.threadId}`,
        ) ?? null)
      : routeTarget?.kind === "draft"
        ? routeDraftProjectKey
        : null;
  const routeSpaces = routeProjectKey === null ? null : projectSpaces(routeProjectKey);
  const routeKey =
    routeTarget?.kind === "server"
      ? `server:${routeTarget.threadRef.environmentId}:${routeTarget.threadRef.threadId}`
      : routeTarget?.kind === "draft"
        ? `draft:${routeTarget.draftId}`
        : null;

  // Remember the open thread for its space; one outside the active space takes the sidebar to
  // its home space. Once per route, so switching spaces or removing the open project from a
  // space never bounces the active space back.
  const handledRouteKeyRef = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- switches the space store to match the opened route
  useEffect(() => {
    if (!spacesOn || routeTarget === null || routeKey === null || routeSpaces === null) return;
    if (handledRouteKeyRef.current === routeKey) return;
    handledRouteKeyRef.current = routeKey;
    const store = useSpaceStore.getState();
    const route: SpaceRoute =
      routeTarget.kind === "server"
        ? {
            kind: "server",
            environmentId: routeTarget.threadRef.environmentId,
            threadId: routeTarget.threadRef.threadId,
          }
        : { kind: "draft", draftId: routeTarget.draftId };
    if (isInSpace(routeSpaces, store.activeSpaceId)) {
      store.rememberRoute(store.activeSpaceId, route);
      return;
    }
    const homeSpaceId = routeSpaces.homeSpaceId;
    store.setActiveSpace(homeSpaceId);
    setProjectScopeKeys(store.projectScopeKeyBySpaceId[homeSpaceId] ?? []);
    store.rememberRoute(homeSpaceId, route);
  }, [routeKey, routeSpaces, routeTarget, setProjectScopeKeys, spacesOn]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- remembers the project scope in the space store
  useEffect(() => {
    useSpaceStore.getState().rememberProjectScope(activeSpaceId, projectScopeKeys);
  }, [activeSpaceId, projectScopeKeys]);

  const threadsRef = useRef(threads);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors threads into a ref read by callbacks
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);
  const switchSpace = (spaceId: string) => {
    const store = useSpaceStore.getState();
    if (!spacesOn || spaceId === store.activeSpaceId) return;
    store.setActiveSpace(spaceId);
    setProjectScopeKeys(store.projectScopeKeyBySpaceId[spaceId] ?? []);
    // While the manager shows, it stays: the new space's profile manager takes its place.
    if (useManagerViewStore.getState().shown) {
      requestManagerShown();
      return;
    }
    const route = store.lastRouteBySpaceId[spaceId];
    const inSpace = (projectKey: string) => isInSpace(projectSpaces(projectKey), spaceId);
    if (route?.kind === "server") {
      const thread = threadsRef.current.find(
        (candidate) =>
          candidate.environmentId === route.environmentId && candidate.id === route.threadId,
      );
      if (
        thread &&
        thread.archivedAt === null &&
        inSpace(`${thread.environmentId}:${thread.projectId}`)
      ) {
        void router.navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: route.environmentId, threadId: route.threadId },
        });
        return;
      }
    }
    if (route?.kind === "draft") {
      const session = useComposerDraftStore.getState().getDraftSession(route.draftId as DraftId);
      if (
        session &&
        session.promotedTo == null &&
        inSpace(`${session.environmentId}:${session.projectId}`)
      ) {
        void router.navigate({ to: "/draft/$draftId", params: { draftId: route.draftId } });
        return;
      }
    }
    // The index opens a draft in the space's most recent project.
    void router.navigate({ to: "/" });
  };

  const setProjectInSpace = (group: SpaceProjectGroup, spaceId: string, member: boolean) => {
    useSpaceStore.getState().setProjectsInSpace(memberKeysOf(group), spaceId, member);
  };

  const projectMemberKeys = (projectKey: string) =>
    memberKeysByProjectKey.get(projectKey) ?? [projectKey];

  return {
    spaces,
    activeSpaceId,
    spaceProjectGroups,
    groupSpaces,
    projectSpaces,
    projectMemberKeys,
    switchSpace,
    setProjectInSpace,
  };
}
