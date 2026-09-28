import type { ScopedProjectRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import {
  ALL_SPACE_ID,
  isInSpace,
  type SpaceRoute,
  useProjectSpaceResolver,
  useSpaceStore,
} from "../../spaceStore";
import type { ThreadRouteTarget } from "../../threadRoutes";

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
  readonly projectScopeKey: string | null;
  readonly setProjectScopeKey: (projectKey: string | null) => void;
}) {
  const { projectGroups, threads, routeTarget, routeDraftProjectKey, projectScopeKey } = input;
  const { setProjectScopeKey } = input;
  const router = useRouter();
  const activeSpaceId = useSpaceStore((store) => store.activeSpaceId);
  const spaces = useSpaceStore((store) => store.spaces);
  const resolveSpace = useProjectSpaceResolver();

  const groupSpaces = useCallback(
    (group: SpaceProjectGroup) => resolveSpace(memberKeysOf(group)),
    [resolveSpace],
  );
  // A project resolves through its whole group, so a thread and the group
  // that lists it always agree on the space.
  const memberKeysByProjectKey = useMemo(() => {
    const byKey = new Map<string, ReadonlyArray<string>>();
    for (const group of projectGroups) {
      const memberKeys = memberKeysOf(group);
      for (const key of memberKeys) byKey.set(key, memberKeys);
    }
    return byKey;
  }, [projectGroups]);
  const projectSpaces = useCallback(
    (projectKey: string) => resolveSpace(memberKeysByProjectKey.get(projectKey) ?? [projectKey]),
    [memberKeysByProjectKey, resolveSpace],
  );
  const spaceProjectGroups = useMemo(
    () =>
      activeSpaceId === ALL_SPACE_ID
        ? projectGroups
        : projectGroups.filter((group) => isInSpace(groupSpaces(group), activeSpaceId)),
    [activeSpaceId, groupSpaces, projectGroups],
  );
  const threadProjectKeyByThreadKey = useMemo(
    () =>
      new Map(
        threads.map(
          (thread) =>
            [
              `${thread.environmentId}:${thread.id}`,
              `${thread.environmentId}:${thread.projectId}`,
            ] as const,
        ),
      ),
    [threads],
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

  // Remember the open thread for its space. A thread outside the active space
  // (opened from search, a notification, or a link) takes the sidebar to its
  // project's home space. Runs once per route, so switching spaces (which
  // navigates right after changing the active space) and removing the open
  // project from a space never bounce the active space back.
  const handledRouteKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (routeTarget === null || routeKey === null || routeSpaces === null) return;
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
    setProjectScopeKey(store.projectScopeKeyBySpaceId[homeSpaceId] ?? null);
    store.rememberRoute(homeSpaceId, route);
  }, [routeKey, routeSpaces, routeTarget, setProjectScopeKey]);

  useEffect(() => {
    useSpaceStore.getState().rememberProjectScope(activeSpaceId, projectScopeKey);
  }, [activeSpaceId, projectScopeKey]);

  const threadsRef = useRef(threads);
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);
  const switchSpace = useCallback(
    (spaceId: string) => {
      const store = useSpaceStore.getState();
      if (spaceId === store.activeSpaceId) return;
      store.setActiveSpace(spaceId);
      setProjectScopeKey(store.projectScopeKeyBySpaceId[spaceId] ?? null);
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
    },
    [projectSpaces, router, setProjectScopeKey],
  );

  const setProjectInSpace = useCallback(
    (group: SpaceProjectGroup, spaceId: string, member: boolean) => {
      useSpaceStore.getState().setProjectsInSpace(memberKeysOf(group), spaceId, member);
    },
    [],
  );

  const projectMemberKeys = useCallback(
    (projectKey: string) => memberKeysByProjectKey.get(projectKey) ?? [projectKey],
    [memberKeysByProjectKey],
  );

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
