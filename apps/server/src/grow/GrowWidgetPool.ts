/**
 * GrowWidgetPool - the folder of widgets Grow draws each thread's living page from.
 *
 * T3 ships no widgets: the pool is a folder of `<Name>.tsx` files the user keeps (the
 * `growWidgetPool` setting), each a React component plus a `meta` of description, props schema
 * and example. The pool is compiled here once per change, so the page writer reads every
 * widget's meta and the client's sandboxed frame receives ready-to-run code.
 *
 * @module GrowWidgetPool
 */
import type { GrowWidget } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { transform } from "sucrase";
import * as NodeVM from "node:vm";

import * as ServerSettings from "../serverSettings.ts";

const WIDGET_FILE = /^([A-Z][A-Za-z0-9]{0,59})\.tsx$/;

export class GrowWidgetPoolError extends Schema.TaggedError<GrowWidgetPoolError>()(
  "GrowWidgetPoolError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export interface GrowWidgetPoolSnapshot {
  /** Empty when no pool is set. */
  readonly dir: string;
  readonly readme: string;
  /** Every widget that compiled, by name. */
  readonly widgets: ReadonlyArray<GrowWidget>;
  /** Widgets that did not compile, with why, so the gallery can say so. */
  readonly broken: ReadonlyArray<{ readonly name: string; readonly error: string }>;
}

const EMPTY: GrowWidgetPoolSnapshot = { dir: "", readme: "", widgets: [], broken: [] };

/** TSX to the CommonJS the client's frame runs, with React's automatic JSX runtime. */
export function compileWidget(source: string, name: string): string {
  return transform(source, {
    transforms: ["typescript", "jsx", "imports"],
    jsxRuntime: "automatic",
    production: true,
    filePath: `${name}.tsx`,
  }).code;
}

/**
 * Reads a compiled widget's `meta` without rendering it: the module runs in a bare context where
 * every import is an inert stand-in, so only its top-level data is real.
 */
export function readWidgetMeta(code: string): GrowWidget["meta"] {
  const inert: object = new Proxy(function () {}, {
    get: (_target, key) => (key === Symbol.toPrimitive ? () => "" : inert),
    apply: () => inert,
    construct: () => inert,
  });
  const module = { exports: {} as Record<string, unknown> };
  NodeVM.runInNewContext(
    code,
    { module, exports: module.exports, require: () => inert },
    {
      timeout: 200,
    },
  );
  const meta = module.exports.meta as Record<string, unknown> | undefined;
  if (typeof module.exports.default !== "function") {
    throw new Error("It has no default-exported component.");
  }
  if (meta === undefined || typeof meta.description !== "string") {
    throw new Error("Its `meta` needs a `description`.");
  }
  return {
    description: meta.description,
    props: (meta.props as Record<string, unknown> | undefined) ?? {},
    example: (meta.example as Record<string, unknown> | undefined) ?? {},
  };
}

/** The pool as the page writer reads it: one entry per widget, its meta as JSON. */
export function poolCatalog(pool: GrowWidgetPoolSnapshot): string {
  return pool.widgets
    .map((widget) =>
      [
        `### ${widget.name}`,
        widget.meta.description,
        `props: ${JSON.stringify(widget.meta.props)}`,
        `example: ${JSON.stringify(widget.meta.example)}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export class GrowWidgetPool extends Context.Service<
  GrowWidgetPool,
  {
    /** The pool as it is on disk now; compiled again only for files that changed. */
    readonly read: Effect.Effect<GrowWidgetPoolSnapshot>;
    /** A widget's source as written, for the smith to match in style; empty when unknown. */
    readonly source: (name: string) => Effect.Effect<string>;
    /** Adds a widget the widget smith wrote, after checking it compiles and has a meta. */
    readonly write: (
      name: string,
      source: string,
    ) => Effect.Effect<GrowWidget, GrowWidgetPoolError>;
  }
>()("t3/grow/GrowWidgetPool") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settings = yield* ServerSettings.ServerSettingsService;
  // Compiled widgets by file path and modification time, so a read only compiles what changed.
  const compiled = yield* Ref.make(
    new Map<string, { readonly mtime: number; readonly result: GrowWidget | string }>(),
  );

  const poolDir = settings.getSettings.pipe(
    Effect.map((current) => current.growWidgetPool.trim()),
    Effect.orElseSucceed(() => ""),
  );

  const compileFile = (name: string, source: string): GrowWidget | string => {
    try {
      const code = compileWidget(source, name);
      return { name, code, meta: readWidgetMeta(code) };
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  const read: GrowWidgetPool["Service"]["read"] = Effect.gen(function* () {
    const dir = yield* poolDir;
    if (dir === "" || !path.isAbsolute(dir)) return EMPTY;
    const entries = yield* fileSystem
      .readDirectory(dir)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const cache = yield* Ref.get(compiled);
    const next = new Map<
      string,
      { readonly mtime: number; readonly result: GrowWidget | string }
    >();
    const widgets: GrowWidget[] = [];
    const broken: Array<{ name: string; error: string }> = [];
    for (const entry of [...entries].toSorted()) {
      const name = WIDGET_FILE.exec(entry)?.[1];
      if (name === undefined) continue;
      const file = path.join(dir, entry);
      const info = yield* fileSystem.stat(file).pipe(Effect.option);
      if (info._tag === "None") continue;
      const mtime = info.value.mtime._tag === "Some" ? info.value.mtime.value.getTime() : 0;
      const cached = cache.get(file);
      const result =
        cached !== undefined && cached.mtime === mtime
          ? cached.result
          : yield* fileSystem.readFileString(file).pipe(
              Effect.map((source) => compileFile(name, source)),
              Effect.orElseSucceed(() => "It could not be read."),
            );
      next.set(file, { mtime, result });
      if (typeof result === "string") broken.push({ name, error: result });
      else widgets.push(result);
    }
    yield* Ref.set(compiled, next);
    const readme = yield* fileSystem
      .readFileString(path.join(dir, "README.md"))
      .pipe(Effect.orElseSucceed(() => ""));
    return { dir, readme, widgets, broken };
  }).pipe(Effect.withSpan("GrowWidgetPool.read"));

  const write: GrowWidgetPool["Service"]["write"] = Effect.fn("GrowWidgetPool.write")(
    function* (name, source) {
      const dir = yield* poolDir;
      if (dir === "" || !path.isAbsolute(dir)) {
        return yield* new GrowWidgetPoolError({ detail: "No widget pool is set." });
      }
      if (!WIDGET_FILE.test(`${name}.tsx`)) {
        return yield* new GrowWidgetPoolError({ detail: `"${name}" is not a PascalCase name.` });
      }
      const result = compileFile(name, source);
      if (typeof result === "string") {
        return yield* new GrowWidgetPoolError({ detail: `${name} does not compile: ${result}` });
      }
      const file = path.join(dir, `${name}.tsx`);
      if (yield* fileSystem.exists(file).pipe(Effect.orElseSucceed(() => false))) {
        return yield* new GrowWidgetPoolError({ detail: `${name} is already in the pool.` });
      }
      yield* fileSystem
        .writeFileString(file, source.endsWith("\n") ? source : `${source}\n`)
        .pipe(
          Effect.mapError(() => new GrowWidgetPoolError({ detail: `Could not write ${file}.` })),
        );
      return result;
    },
  );

  const source: GrowWidgetPool["Service"]["source"] = (name) =>
    Effect.gen(function* () {
      const dir = yield* poolDir;
      if (dir === "" || !WIDGET_FILE.test(`${name}.tsx`)) return "";
      return yield* fileSystem.readFileString(path.join(dir, `${name}.tsx`));
    }).pipe(Effect.orElseSucceed(() => ""));

  return GrowWidgetPool.of({ read, source, write });
});

export const layer = Layer.effect(GrowWidgetPool, make);
