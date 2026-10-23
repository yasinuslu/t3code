import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, ListFilterIcon } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";

import type { SheetData } from "./spreadsheetDocument";
import {
  type ColumnFilter,
  type ColumnKind,
  columnFacets,
  columnKind,
  filterIsActive,
  fold,
  parseNumber,
  type SheetView,
} from "./spreadsheetView";

/** Value rows drawn at once; a long list narrows through its search field. */
const MAX_VALUE_ROWS = 300;

const SORT_LABELS: Record<ColumnKind, readonly [string, string]> = {
  text: ["Sort A to Z", "Sort Z to A"],
  number: ["Smallest first", "Largest first"],
  date: ["Oldest first", "Newest first"],
};

const BLANKS = "(Blanks)";

/** Keys typed in the panel must not reach the grid, which would treat them as cell input. */
function keepKeysInPanel(event: KeyboardEvent) {
  if (event.key !== "Escape") event.stopPropagation();
}

function FilterPanel(props: {
  readonly sheet: SheetData;
  readonly view: SheetView;
  readonly column: number;
  readonly label: string;
  readonly onSort: (direction: "asc" | "desc") => void;
  readonly onApply: (filter: ColumnFilter | undefined) => void;
}) {
  const { sheet, view, column } = props;
  const kind = useMemo(() => columnKind(sheet, column), [sheet, column]);
  const facets = useMemo(() => columnFacets(sheet, view, column), [sheet, view, column]);
  const current = view.filters[column];
  const [exclude, setExclude] = useState<ReadonlySet<string>>(current?.exclude ?? new Set());
  const [contains, setContains] = useState(current?.contains ?? "");
  const [min, setMin] = useState(current?.min?.toString() ?? "");
  const [max, setMax] = useState(current?.max?.toString() ?? "");
  const [find, setFind] = useState("");

  const needle = fold(find.trim());
  const visible = useMemo(
    () =>
      needle === ""
        ? facets
        : facets.filter((facet) =>
            fold(facet.value === "" ? BLANKS : facet.value).includes(needle),
          ),
    [facets, needle],
  );
  const shown = visible.slice(0, MAX_VALUE_ROWS);
  const checkedCount = visible.filter((facet) => !exclude.has(facet.value)).length;

  const toggle = (value: string) =>
    setExclude((previous) => {
      const next = new Set(previous);
      if (!next.delete(value)) next.add(value);
      return next;
    });

  const toggleAll = () =>
    setExclude((previous) => {
      const next = new Set(previous);
      for (const facet of visible) {
        if (checkedCount === visible.length) next.add(facet.value);
        else next.delete(facet.value);
      }
      return next;
    });

  const apply = () => {
    const next: ColumnFilter = {
      ...(exclude.size > 0 ? { exclude } : {}),
      ...(contains.trim() !== "" ? { contains: contains.trim() } : {}),
      ...(kind === "number" && parseNumber(min) !== null ? { min: parseNumber(min)! } : {}),
      ...(kind === "number" && parseNumber(max) !== null ? { max: parseNumber(max)! } : {}),
    };
    props.onApply(filterIsActive(next) ? next : undefined);
  };

  const [ascending, descending] = SORT_LABELS[kind];
  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    }
  };

  return (
    <div className="flex flex-col gap-2 text-xs" onKeyDown={keepKeysInPanel}>
      <p className="truncate font-medium">{props.label}</p>
      <div className="flex gap-1.5">
        <Button variant="outline" size="compact" onClick={() => props.onSort("asc")}>
          <ArrowUpIcon />
          {ascending}
        </Button>
        <Button variant="outline" size="compact" onClick={() => props.onSort("desc")}>
          <ArrowDownIcon />
          {descending}
        </Button>
      </div>
      {kind === "number" ? (
        <div className="flex items-center gap-1.5">
          <Input
            size="compact"
            inputMode="decimal"
            aria-label="Minimum"
            placeholder="Min"
            value={min}
            onChange={(event) => setMin(event.target.value)}
            onKeyDown={submitOnEnter}
          />
          <span className="text-muted-foreground">to</span>
          <Input
            size="compact"
            inputMode="decimal"
            aria-label="Maximum"
            placeholder="Max"
            value={max}
            onChange={(event) => setMax(event.target.value)}
            onKeyDown={submitOnEnter}
          />
        </div>
      ) : (
        <Input
          size="compact"
          aria-label="Contains"
          placeholder="Text contains"
          value={contains}
          onChange={(event) => setContains(event.target.value)}
          onKeyDown={submitOnEnter}
        />
      )}
      <Input
        size="compact"
        type="search"
        aria-label="Search values"
        placeholder="Search values"
        value={find}
        onChange={(event) => setFind(event.target.value)}
        onKeyDown={submitOnEnter}
      />
      <div role="group" aria-label="Values" className="max-h-56 overflow-y-auto">
        {visible.length > 0 ? (
          <label className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent">
            <Checkbox
              checked={checkedCount === visible.length}
              indeterminate={checkedCount > 0 && checkedCount < visible.length}
              onCheckedChange={toggleAll}
            />
            <span className="flex-1">{needle === "" ? "Select all" : "Select all results"}</span>
          </label>
        ) : (
          <p className="px-1 py-2 text-muted-foreground">No matching values.</p>
        )}
        {shown.map((facet) => (
          <label
            key={facet.value}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent"
          >
            <Checkbox
              checked={!exclude.has(facet.value)}
              onCheckedChange={() => toggle(facet.value)}
            />
            <span
              className={facet.value === "" ? "flex-1 text-muted-foreground" : "flex-1 truncate"}
            >
              {facet.value === "" ? BLANKS : facet.value}
            </span>
            <span className="tabular-nums text-muted-foreground">{facet.count}</span>
          </label>
        ))}
        {visible.length > shown.length ? (
          <p className="px-1 py-1.5 text-muted-foreground">
            {visible.length - shown.length} more. Search to narrow the list.
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-1.5">
        <Button
          variant="ghost"
          size="compact"
          disabled={!filterIsActive(current)}
          onClick={() => props.onApply(undefined)}
        >
          Clear
        </Button>
        <Button size="compact" onClick={apply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

/**
 * The two buttons on a header cell: a sort button that cycles ascending, descending, off, and
 * a filter button that opens the column's value list. Both show when they are in effect.
 */
export function SpreadsheetColumnMenu(props: {
  readonly sheet: SheetData;
  readonly view: SheetView;
  readonly column: number;
  readonly label: string;
  readonly onSort: (column: number, direction: "asc" | "desc" | null) => void;
  readonly onFilter: (column: number, filter: ColumnFilter | undefined) => void;
}) {
  const { column, view } = props;
  const [open, setOpen] = useState(false);
  const sort = view.sort?.column === column ? view.sort.direction : null;
  const filtered = filterIsActive(view.filters[column]);
  const name = props.label || `column ${column + 1}`;

  return (
    <>
      <Button
        variant={sort ? "secondary" : "ghost-muted"}
        size="icon-micro"
        aria-label={
          sort === "asc"
            ? `Sorted ascending: ${name}. Sort descending`
            : sort === "desc"
              ? `Sorted descending: ${name}. Clear sort`
              : `Sort ${name}`
        }
        onClick={() => props.onSort(column, sort === null ? "asc" : sort === "asc" ? "desc" : null)}
      >
        {sort === "asc" ? (
          <ArrowUpIcon />
        ) : sort === "desc" ? (
          <ArrowDownIcon />
        ) : (
          <ChevronsUpDownIcon />
        )}
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant={filtered ? "default" : "ghost-muted"}
              size="icon-micro"
              aria-label={filtered ? `Filtered: ${name}. Edit filter` : `Filter ${name}`}
            />
          }
        >
          <ListFilterIcon />
        </PopoverTrigger>
        <PopoverPopup width="md" padding="compact" align="start">
          <FilterPanel
            sheet={props.sheet}
            view={view}
            column={column}
            label={name}
            onSort={(direction) => {
              props.onSort(column, direction);
              setOpen(false);
            }}
            onApply={(filter) => {
              props.onFilter(column, filter);
              setOpen(false);
            }}
          />
        </PopoverPopup>
      </Popover>
    </>
  );
}
