import {
  type PresentationPage,
  THREAD_PRESENTATION_MAX_PAGES,
  THREAD_PRESENTATION_MAX_VERSIONS,
  type ThreadPresentation,
} from "@t3tools/contracts";

/**
 * A presentation is versioned like code: every edit during one run of the agent amends the
 * same version, and the first edit of a later run starts the next one. These are the pure
 * rules; the MCP handlers store files and snapshots, the orchestrator applies the result.
 */

/** Whether pages written during `run` start a new version rather than amend the current one. */
export function startsNewVersion(
  previous: ThreadPresentation | undefined,
  run: string | undefined,
): boolean {
  if (previous === undefined) return true;
  const current = previous.versions?.at(-1);
  // A presentation from before versions is version 1, moved past by the first versioned edit.
  if (current === undefined) return run !== undefined;
  return run !== undefined && run !== current.run;
}

/**
 * Gives every page an id. `set` replaces the whole list, so a page without one keeps the id of
 * the page that stood in its place; an added page (`edit`) takes the next free `page-<n>`.
 */
export function withPageIds(
  pages: ReadonlyArray<PresentationPage>,
  previous: ReadonlyArray<PresentationPage>,
  reusePlaces: boolean,
): ReadonlyArray<PresentationPage> {
  const taken = new Set<string>();
  for (const page of pages) if (page.id !== undefined) taken.add(page.id);
  let next = 1;
  const fresh = () => {
    while (taken.has(`page-${next}`) || previous.some((page) => page.id === `page-${next}`)) {
      next += 1;
    }
    taken.add(`page-${next}`);
    return `page-${next}`;
  };
  return pages.map((page, index) => {
    if (page.id !== undefined) return page;
    const inPlace = reusePlaces ? previous[index]?.id : undefined;
    if (inPlace !== undefined && !taken.has(inPlace)) {
      taken.add(inPlace);
      return { ...page, id: inPlace };
    }
    return { ...page, id: fresh() };
  });
}

/** A presentation's pages, each with an id; pages from before ids get theirs by place. */
export function presentationPages(
  presentation: ThreadPresentation | undefined,
): ReadonlyArray<PresentationPage> {
  return withPageIds(presentation?.pages ?? [], [], true);
}

/** One edit to a presentation, as `presentation_edit` takes it, with files already stored. */
export interface PresentationEdit {
  /** Replaces the page with the same id in place, or adds it at the end. */
  readonly put?: ReadonlyArray<PresentationPage>;
  readonly remove?: ReadonlyArray<string>;
  /** Ids in the order they should be seen; pages not listed follow in their current order. */
  readonly order?: ReadonlyArray<string>;
}

/** The pages after an edit, or what is wrong with it. */
export function applyPresentationEdit(
  pages: ReadonlyArray<PresentationPage>,
  edit: PresentationEdit,
): ReadonlyArray<PresentationPage> | string {
  let next = [...pages];
  for (const page of withPageIds(edit.put ?? [], pages, false)) {
    const at = next.findIndex((candidate) => candidate.id === page.id);
    if (at === -1) next.push(page);
    else next[at] = page;
  }
  for (const id of edit.remove ?? []) {
    if (!next.some((page) => page.id === id)) return `There is no page "${id}" to remove.`;
    next = next.filter((page) => page.id !== id);
  }
  if (edit.order !== undefined) {
    const listed: PresentationPage[] = [];
    for (const id of edit.order) {
      const page = next.find((candidate) => candidate.id === id);
      if (page === undefined) return `There is no page "${id}" to order.`;
      if (!listed.includes(page)) listed.push(page);
    }
    next = [...listed, ...next.filter((page) => !listed.includes(page))];
  }
  if (next.length > THREAD_PRESENTATION_MAX_PAGES) {
    return `A presentation holds at most ${THREAD_PRESENTATION_MAX_PAGES} pages.`;
  }
  return next;
}

/** A page's content, the same whatever order its fields were written in. */
const content = (page: PresentationPage) => {
  const { revision: _revision, ...rest } = page;
  return JSON.stringify(rest, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right)),
        )
      : value,
  );
};

/**
 * The presentation after pages are written during `run`: the version they belong to, and each
 * page's revision (the version it last changed in). No pages removes the presentation.
 */
export function nextPresentation(
  previous: ThreadPresentation | undefined,
  input: {
    readonly pages: ReadonlyArray<PresentationPage>;
    readonly run: string | undefined;
    readonly snapshot: string | undefined;
  },
  at: string,
): ThreadPresentation | undefined {
  if (input.pages.length === 0) return undefined;
  const before = presentationPages(previous);
  const pages = withPageIds(input.pages, before, true).slice(0, THREAD_PRESENTATION_MAX_PAGES);
  let versions = [...(previous?.versions ?? [])];
  if (previous !== undefined && versions.length === 0) {
    versions = [{ version: 1, run: "", startedAt: previous.updatedAt }];
  }
  if (startsNewVersion(previous, input.run)) {
    const current = versions.at(-1);
    if (current !== undefined && input.snapshot !== undefined) {
      versions[versions.length - 1] = { ...current, snapshot: input.snapshot };
    }
    versions.push({ version: (current?.version ?? 0) + 1, run: input.run ?? "", startedAt: at });
  }
  const version = versions.at(-1)?.version ?? 1;
  return {
    pages: pages.map((page) => {
      const was = before.find((candidate) => candidate.id === page.id);
      const revision =
        was !== undefined && content(was) === content(page) ? (was.revision ?? 1) : version;
      return { ...page, revision };
    }),
    updatedAt: at,
    versions: versions.slice(-THREAD_PRESENTATION_MAX_VERSIONS),
  };
}
