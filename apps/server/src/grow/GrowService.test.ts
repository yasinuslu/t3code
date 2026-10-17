// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import { GrowService, layer } from "./GrowService.ts";

const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const fromJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown)) as (text: string) => {
  cards: unknown[];
};

let home = "";
beforeEach(() => {
  home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "grow-home-"));
});
afterEach(() => {
  NodeFS.rmSync(home, { recursive: true, force: true });
});

const build = Effect.fn("buildGrowService")(function* () {
  const deps = ServerConfig.layerTest(home, home).pipe(Layer.provideMerge(NodeServices.layer));
  const services = yield* Layer.build(layer.pipe(Layer.provide(deps)));
  return Context.get(services, GrowService);
});

const threadId = ThreadId.make("thread-1");

describe("GrowService", () => {
  it.effect("merges updates, appends lessons without duplicates and clears the stage", () =>
    Effect.gen(function* () {
      const grow = yield* build();
      yield* grow.update({
        threadId,
        stage: "play",
        became: " a clickable board ",
        addLessons: ["fast"],
      });
      const card = yield* grow.update({ threadId, addLessons: ["fast", " loud "] });
      expect(card.stage).toBe("play");
      expect(card.became).toBe("a clickable board");
      expect(card.lessons).toEqual(["fast", "loud"]);

      const replaced = yield* grow.update({ threadId, lessons: ["only this"], stage: null });
      expect(replaced.lessons).toEqual(["only this"]);
      expect(replaced.stage).toBeUndefined();
      expect(replaced.became).toBe("a clickable board");
    }).pipe(Effect.scoped),
  );

  it.effect("decisions move the stage", () =>
    Effect.gen(function* () {
      const grow = yield* build();
      yield* grow.update({ threadId, stage: "regroup" });
      const adopted = yield* grow.update({ threadId, decision: "adopt" });
      expect(adopted.stage).toBeUndefined();
      expect(adopted.decision).toBe("adopt");

      const shelved = yield* grow.update({ threadId, decision: "shelve" });
      expect(shelved.stage).toBe("shelved");

      const back = yield* grow.update({ threadId, stage: null, decision: null });
      expect(back.stage).toBeUndefined();
      expect(back.decision).toBeUndefined();
    }).pipe(Effect.scoped),
  );

  it.effect("keeps its cards across a reload", () =>
    Effect.gen(function* () {
      const first = yield* build();
      yield* first.update({ threadId, became: "kept", addLessons: ["lesson"] });
      const second = yield* build();
      const state = yield* second.state;
      expect(state.cards.map((card) => [card.threadId, card.became, card.lessons])).toEqual([
        [threadId, "kept", ["lesson"]],
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the usable parts of a card whose shape changed", () =>
    Effect.gen(function* () {
      NodeFS.mkdirSync(NodePath.join(home, "userdata"), { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(home, "userdata", "grow.json"),
        toJson({
          cards: [
            {
              threadId: "a",
              stage: "from-the-future",
              became: "kept",
              lessons: ["x", 3],
              extra: 1,
            },
            { stage: "play" },
            "junk",
            { threadId: "b", stage: "play", decision: "adopt", lessons: "nope" },
          ],
        }),
      );
      const grow = yield* build();
      const cards = (yield* grow.state).cards;
      expect(cards.map((card) => card.threadId)).toEqual(["a", "b"]);
      expect(cards[0]).toMatchObject({ became: "kept", lessons: ["x"] });
      expect(cards[0]?.stage).toBeUndefined();
      expect(cards[1]).toMatchObject({ stage: "play", decision: "adopt", lessons: [] });
    }).pipe(Effect.scoped),
  );

  it.effect(
    "starts empty on an unreadable file, leaves it alone, and keeps it as .bad on first update",
    () =>
      Effect.gen(function* () {
        const file = NodePath.join(home, "userdata", "grow.json");
        NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
        NodeFS.writeFileSync(file, "{ not json");
        const grow = yield* build();
        expect((yield* grow.state).cards).toEqual([]);
        expect(NodeFS.readFileSync(file, "utf8")).toBe("{ not json");

        yield* grow.update({ threadId, became: "fresh" });
        expect(NodeFS.readFileSync(`${file}.bad`, "utf8")).toBe("{ not json");
        expect(fromJson(NodeFS.readFileSync(file, "utf8")).cards).toHaveLength(1);
      }).pipe(Effect.scoped),
  );

  it.effect("streams the current state, then each change", () =>
    Effect.gen(function* () {
      const grow = yield* build();
      yield* grow.update({ threadId, became: "one" });
      const seen = yield* grow.changes.pipe(Stream.take(1), Stream.runCollect);
      expect(seen[0]?.cards[0]?.became).toBe("one");
    }).pipe(Effect.scoped),
  );
});
