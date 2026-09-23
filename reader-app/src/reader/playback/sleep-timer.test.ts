import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSleepTimer } from "./sleep-timer.ts";

// A hand-cranked clock so minutes pass instantly.
function clock() {
  let now = 0;
  let pending: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 0;
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      nextId += 1;
      pending.push({ at: now + ms, fn, id: nextId });
      return nextId;
    },
    clearTimer: (id: unknown) => {
      pending = pending.filter((entry) => entry.id !== id);
    },
    advance(ms: number) {
      now += ms;
      const due = pending.filter((entry) => entry.at <= now);
      pending = pending.filter((entry) => entry.at > now);
      for (const entry of due) entry.fn();
    },
  };
}

function timerWith() {
  const time = clock();
  let pauses = 0;
  const timer = createSleepTimer({ ...time, onExpire: () => (pauses += 1) });
  return { timer, time, pauses: () => pauses };
}

describe("sleep timer", () => {
  it("pauses playback once the chosen time is up, then switches itself off", () => {
    const { timer, time, pauses } = timerWith();

    timer.start(15);
    time.advance(14 * 60_000);
    assert.equal(pauses(), 0);
    time.advance(60_000);

    assert.equal(pauses(), 1);
    assert.equal(timer.mode, "off");
  });

  it("keeps playing when the timer is cancelled", () => {
    const { timer, time, pauses } = timerWith();

    timer.start(15);
    timer.cancel();
    time.advance(60 * 60_000);

    assert.equal(pauses(), 0);
  });

  it("in end-of-chapter mode, stops before the next chapter begins and not before", () => {
    const { timer, pauses } = timerWith();
    timer.stopAtChapterEnd();

    assert.equal(timer.shouldStopBefore({ type: "paragraph" }), false);
    assert.equal(pauses(), 0);
    assert.equal(timer.shouldStopBefore({ type: "heading" }), true);
    assert.equal(pauses(), 1);
    assert.equal(timer.mode, "off");
    assert.equal(timer.shouldStopBefore({ type: "heading" }), false);
  });
});
