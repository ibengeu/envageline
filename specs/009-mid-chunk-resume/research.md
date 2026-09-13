# Phase 0 Research: Mid-Chunk Resume Position

No `NEEDS CLARIFICATION` markers remain. Research here pins down the one-shot consumption
mechanism and the invalid-offset fallback, both directly informed by inspecting the real
`speakLocalChunk`/`readBookmark`/`saveBookmark` code before design (see plan.md's critical
finding on `BOOKMARK_VERSION`).

## Decision 1: No version bump — purely additive optional field

**Decision**: `BOOKMARK_VERSION` stays `1`. The new field (`offsetSeconds`) is added to the JSON
object `saveBookmark` writes, and `readBookmark`'s validation treats it as optional: present and
a finite, non-negative number → valid; absent → valid (matching every pre-009 record); present
but invalid (non-number, negative, `NaN`) → the field is treated as absent (ignored), not as
grounds to discard the whole bookmark record.

**Rationale**: Directly required by the finding in plan.md's Summary — `readBookmark` checks
`value.version === BOOKMARK_VERSION` with strict equality. Bumping the version would fail that
check for every existing bookmark (which stored `version: 1`) the moment `BOOKMARK_VERSION`
became `2`, causing `readBookmark` to `storage.removeItem(key)` and return `null` — silently
deleting every listener's existing bookmark on upgrade. This is exactly the regression FR-004
forbids. Treating the field as purely optional under the unchanged version number avoids the
issue entirely without needing to introduce version-gated branching into `readBookmark`.

**Alternatives considered**:
- *Bump `BOOKMARK_VERSION` to `2` and change the check to `value.version <= BOOKMARK_VERSION` (or
  an explicit set of accepted versions)*: would work, but is strictly more complex than not
  bumping the version at all for a field that's optional anyway — Principle V favors the simpler
  path when both achieve the same outcome. A version bump only earns its complexity when a
  *required* field changes shape or a validation rule tightens in a way that must reject old
  data; neither applies here.

## Decision 2: One-shot pending offset via transient session state

**Decision**: A new field, `state.pendingResumeOffsetSeconds`, holds the offset to apply the
*next* time `speakLocalChunk` creates an `Audio` element — set once, when a bookmark with a valid
offset is restored during document load, and cleared (`null`) immediately after
`speakLocalChunk` consumes it (applies it to `state.audio.currentTime`), regardless of whether
application succeeded. Every other call to `speakLocalChunk` (chunk-end auto-advance,
reconnect-after-error) finds `state.pendingResumeOffsetSeconds` already `null` and behaves exactly
as today (starts at time zero, i.e. does nothing extra).

**Rationale**: `speakLocalChunk` is called from four sites (initial resume, chunk-end auto-
advance, error-reconnect, and — after this feature — no new sites), confirmed by inspecting all
call sites before design. Only the very first call after a bookmark restore should apply the
saved offset; every other call must be indistinguishable from today's behavior (FR-003). A
one-shot, consume-and-clear transient value is the simplest mechanism that guarantees this
without needing to compare chunk indices or track "have we resumed yet" as a separate boolean —
clearing the value itself *is* the "already resumed" signal.

**Alternatives considered**:
- *Track a separate boolean flag (`hasAppliedResumeOffset`) alongside a non-nulled offset
  value*: functionally equivalent but adds a second piece of state to keep in sync for no
  benefit — nulling the one value after use is simpler (Principle V).
- *Compare `state.chunkIndex` against the originally-bookmarked index inside `speakLocalChunk` to
  decide whether to apply the offset*: rejected — this conflates "which chunk is this" with
  "have we already consumed the pending offset," and would incorrectly re-apply the offset if
  the listener ever navigated back to the same chunk index later in the session (e.g. via
  previous-paragraph navigation) — a real edge case the one-shot design avoids by construction.

## Decision 3: Applying and validating the offset

**Decision**: Immediately after `state.audio = new globalScope.Audio(state.audioUrl)` and before
`state.audio.play()`, if `state.pendingResumeOffsetSeconds` is a finite number greater than zero:
attempt `state.audio.currentTime = state.pendingResumeOffsetSeconds`. No pre-check against the
audio's duration is performed synchronously (duration is not reliably known before the browser
has loaded metadata) — instead, the browser's own `Audio.currentTime` setter behavior is relied
upon: setting a value at or beyond the actual duration is clamped/ignored by the platform rather
than throwing, which already satisfies FR-005's "falls back to time zero" requirement for the
out-of-range case without this code needing to duplicate that check. `state.pendingResumeOffsetSeconds`
is set to `null` immediately after this attempt, unconditionally.

**Rationale**: Keeps the implementation minimal (Principle V) by relying on the platform's own
well-defined `currentTime` clamping behavior rather than re-implementing duration validation —
consistent with this project's general preference (seen in `splitLongText`'s reuse in spec 007,
and `localTtsEndpoints`'s reuse in spec 008) for leaning on already-correct existing behavior
instead of adding a parallel check.

**Alternatives considered**:
- *Wait for the `loadedmetadata` event before checking `state.audio.duration` and only then set
  `currentTime`*: adds asynchronous complexity and a new event-listener lifecycle to manage
  (including cleanup) for a case the platform already handles correctly via clamping — rejected
  as unwarranted complexity for this spec's actual requirement (FR-005 only requires *not
  failing*, not precise duration-aware validation).

## Assumptions carried into Phase 1

- `state.audio.currentTime` (a `number`, in seconds) is the unit used throughout — matching
  research.md's premise and spec.md's own Assumption that no new unit conversion is introduced.
- The offset is captured in `saveBookmark` only when `state.audio` exists and its `currentTime`
  is a finite number; when no audio is currently loaded (spec.md's Edge Case), the field is
  simply omitted from the saved record, identical in shape to a pre-009 bookmark.
