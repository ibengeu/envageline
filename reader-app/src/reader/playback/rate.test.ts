import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RATE_PRESETS } from "../core/config.ts";
import { normalizeRate } from "./rate.ts";

describe("choosing a listening speed", () => {
  it("keeps every preset speed exactly as picked", () => {
    for (const preset of RATE_PRESETS) assert.equal(normalizeRate(preset), preset);
  });

  it("keeps speeds inside what the reader supports", () => {
    assert.equal(normalizeRate(9), 3);
    assert.equal(normalizeRate(0.1), 0.5);
  });

  it("falls back to normal speed when handed a speed that is not a number", () => {
    assert.equal(normalizeRate(Number.NaN), 1);
    assert.equal(normalizeRate(Number.POSITIVE_INFINITY), 1);
  });
});
