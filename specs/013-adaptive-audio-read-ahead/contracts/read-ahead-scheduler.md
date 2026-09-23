# Read-Ahead Scheduler Contract

## Purpose

The scheduler prepares upcoming narration audio without changing visible segment order or
highlight timing.

## Public behavior

### `prefetchDepth(input)`

- Input: a recent synthesis-time estimate and a playback-time budget.
- Output: an integer from `1` through `6`.
- Invalid, missing, or non-positive estimates return `1`.
- Faster synthesis or a longer playback budget returns a value that is not lower than the value
  for a slower synthesis estimate or shorter budget.

### `audioFor(segment, options)`

- Returns one promise for the audio matching the segment and narration options.
- Shares an existing in-flight request for the same key.
- Returns completed prepared audio without a second synthesis request.
- Propagates failure when the requested current audio fails.

### `prefetch(segments, currentIndex, options)`

- Starts preparation for the next bounded number of segments.
- Does not reject the caller when a background request fails.
- Does not prepare segments beyond the document.
- Does not move playback state or visible highlighting.

### `reset()`

- Invalidates the active window and its context generation.
- Prevents late work from an earlier context from being returned to a later context.

## Security contract

The scheduler MUST call a synthesizer that enforces loopback endpoint validation before every
request. The scheduler MUST NOT build or alter a remote URL from narration text.
