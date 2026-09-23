import assert from "node:assert/strict";
import { it } from "node:test";
import { scrollPageIntoView } from "./page-navigation.ts";

it("scrolls the selected page inside the reader scroller", () => {
  const scrollCalls: Array<{ top: number; behavior: string }> = [];
  const target = {
    getBoundingClientRect: () => ({ top: 1000, bottom: 1800 }),
  };
  const scroller = {
    scrollTop: 140,
    getBoundingClientRect: () => ({ top: 100, bottom: 800 }),
    querySelector: (selector: string) => (selector === '[data-page="7"]' ? target : null),
    scrollTo: (options: { top: number; behavior: string }) => {
      scrollCalls.push(options);
    },
  };

  assert.equal(scrollPageIntoView(scroller as unknown as HTMLElement, 7), true);
  assert.deepEqual(scrollCalls, [{ top: 1040, behavior: "auto" }]);
});

it("rejects invalid page values before querying the DOM", () => {
  let queried = false;
  const scroller = {
    querySelector: () => {
      queried = true;
      return null;
    },
  };

  assert.equal(scrollPageIntoView(scroller as unknown as HTMLElement, Number.NaN), false);
  assert.equal(scrollPageIntoView(scroller as unknown as HTMLElement, 0), false);
  assert.equal(scrollPageIntoView(scroller as unknown as HTMLElement, 1.5), false);
  assert.equal(queried, false);
});

it("leaves the view alone when the page already fills the screen, so a tap never yanks it", () => {
  const scrollCalls: unknown[] = [];
  const target = { getBoundingClientRect: () => ({ top: 60, bottom: 900 }) };
  const scroller = {
    scrollTop: 400,
    getBoundingClientRect: () => ({ top: 100, bottom: 800 }),
    querySelector: () => target,
    scrollTo: (options: unknown) => scrollCalls.push(options),
  };

  assert.equal(scrollPageIntoView(scroller as unknown as HTMLElement, 3), true);
  assert.deepEqual(scrollCalls, []);
});
