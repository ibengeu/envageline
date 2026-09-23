import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJumpLog, type NarrationMove } from "./jump-log.ts";

function move(overrides: Partial<NarrationMove> = {}): NarrationMove {
  return {
    origin: "auto:next",
    fromId: "doc-p1-b0-s0",
    toId: "doc-p1-b0-s1",
    fromIndex: 0,
    toIndex: 1,
    page: 1,
    ...overrides,
  };
}

describe("narration jump log", () => {
  it("does not flag narration carrying on to the following sentence", () => {
    const log = createJumpLog({ now: () => 0 });
    log.record(move());
    assert.deepEqual(log.unexpected(), []);
  });

  it("flags narration that moves on its own anywhere but the following sentence", () => {
    const log = createJumpLog({ now: () => 0 });
    log.record(move({ fromIndex: 4, toIndex: 12 }));
    log.record(move({ fromIndex: 12, toIndex: 3 }));
    log.record(move({ origin: "reconcile", fromIndex: 3, toIndex: 9 }));
    assert.deepEqual(
      log.unexpected().map((entry) => [entry.fromIndex, entry.toIndex]),
      [[4, 12], [12, 3], [3, 9]],
    );
  });

  it("flags a fallback that could not even place the sentence it came from", () => {
    const log = createJumpLog({ now: () => 0 });
    log.record(move({ origin: "reconcile", fromIndex: null, toIndex: 57 }));
    assert.equal(log.unexpected().length, 1);
  });

  it("never flags a move the listener asked for, however far it goes", () => {
    const log = createJumpLog({ now: () => 0 });
    log.record(move({ origin: "user:tap", fromIndex: 2, toIndex: 400 }));
    log.record(move({ origin: "user:key", fromIndex: 400, toIndex: 399 }));
    log.record(move({ origin: "user:button", fromIndex: 399, toIndex: 0 }));
    assert.deepEqual(log.unexpected(), []);
  });

  it("keeps only the most recent moves once full", () => {
    const log = createJumpLog({ capacity: 3, now: () => 0 });
    for (let index = 0; index < 5; index += 1) {
      log.record(move({ fromIndex: index, toIndex: index + 1 }));
    }
    assert.deepEqual(
      log.entries().map((entry) => entry.fromIndex),
      [2, 3, 4],
    );
  });

  it("never carries sentence text into diagnostics, even when handed a whole sentence", () => {
    const log = createJumpLog({ now: () => 0 });
    const withText = {
      ...move(),
      spokenText: "The confidential merger closes on Friday.",
      originalText: "The confidential merger closes on Friday.",
    };
    log.record(withText);
    assert.doesNotMatch(JSON.stringify(log.entries()), /confidential merger/);
  });
});
