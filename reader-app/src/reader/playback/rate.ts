import { DEFAULT_RATE, MAX_RATE, MIN_RATE, RATE_STEP } from "../core/config.ts";

// Steps per 1x: 20 for a 0.05 step. Rounding with whole steps and dividing
// keeps results exact (1.25 stays 1.25; multiplying by 0.1 gave 1.1000000000000001).
const STEPS_PER_UNIT = Math.round(1 / RATE_STEP);

// The speed actually used for a requested one: on the step grid, so every
// preset (0.75x, 1.25x) survives unchanged, and inside the supported range.
export function normalizeRate(rate: number): number {
  // OWASP A10:2025 Mishandling of Exceptional Conditions - a speed that is
  // not a real number would reach the speech server and the audio element.
  if (!Number.isFinite(rate)) return DEFAULT_RATE;
  const stepped = Math.round(rate * STEPS_PER_UNIT) / STEPS_PER_UNIT;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, stepped));
}
