# Research: Adaptive Audio Read-Ahead

## Decision 1: Port adaptive audio preparation, not segment merging

**Decision**: Keep the new app's narration segments unchanged. Add preparation for upcoming
segments and reuse their audio when playback reaches them.

**Rationale**: The old reader merges short speech chunks before synthesis. The new app uses
sentence-level segments for highlighting and controller navigation. Merging would require a new
mapping between merged audio and visible segments. The user request targets read-ahead, so the
first port keeps the current segment contract intact.

**Alternatives considered**:

- Merge sentences into larger audio requests: rejected because it changes the segment-to-audio
  relationship and risks highlight drift.
- Prefetch only the next segment: rejected because it does not port the old adaptive behavior.

## Decision 2: Use the old conservative dual EWMA policy

**Decision**: Track a fast estimate with alpha `0.3` and a slow estimate with alpha `0.05`. Use the
higher estimate with a `0.9` safety factor, a nine-second playback budget, and a one-to-six bound.

**Rationale**: The old reader already measures local Kokoro response time and uses these values to
reduce stalls without an unbounded request queue. Reusing the policy preserves the known behavior
and keeps the implementation small.

**Alternatives considered**:

- Fixed read-ahead of three: rejected because slow devices would queue unnecessary work.
- A single EWMA: rejected because it reacts poorly to either sudden slowdowns or steady trends.
- A user-configurable amount: rejected because it adds a setting that is not required for the
  optimization.

## Decision 3: Keep a bounded in-memory session cache

**Decision**: Memoize active and prepared audio requests in memory for the current playback
context. Remove entries behind the active passage and reset the cache on document or context
changes. Do not add an IndexedDB audio store in this feature.

**Rationale**: The immediate value is avoiding duplicate synthesis during one reading session.
The current app already has a document storage schema, but persistent audio introduces schema,
eviction, migration, and privacy review work beyond the requested read-ahead port. The bounded
session cache also gives a clear memory limit.

**Alternatives considered**:

- Add a persistent audio LRU cache now: deferred to a separate feature so this port remains small.
- Do not memoize completed requests: rejected because playback would synthesize an audio passage a
  second time after it was prefetched.

## Decision 4: Separate preparation from playback

**Decision**: Extend the Kokoro engine with a public synthesis result and an optional prepared audio
  input for playback. The controller obtains the current audio through the same scheduler used by
  read-ahead, then asks the engine to play that audio.

**Rationale**: The current `speak()` method owns both synthesis and playback. Without a prepared
  audio input, the controller cannot reuse a prefetch and would issue a duplicate request. The
  optional input preserves the existing `speak()` behavior for callers that do not prefetch.

**Alternatives considered**:

- Put the scheduler inside the engine: rejected because the engine cannot know the ordered segment
  list or playback context.
- Expose an `HTMLAudioElement` to the controller: rejected because it leaks browser playback
  details outside the speech engine.

## Decision 5: Cancel and invalidate stale synthesis

**Decision**: Track background synthesis controllers in the Kokoro engine. Stop aborts owned
  synthesis work. The scheduler also uses a context generation so a late completion cannot be
  returned to a later document, voice, rate, or playback session.

**Rationale**: Abort alone cannot protect against a response that wins a race with cancellation.
The two controls provide both resource cleanup and stale-result protection.

**Alternatives considered**:

- Rely only on a playback index check: rejected because document and settings changes can reuse an
  index.
- Ignore cancellation and only clear the map: rejected because the request would continue using
  network, memory, and server resources.

## Decision 6: Preserve loopback validation at the engine boundary

**Decision**: All scheduler requests call the existing Kokoro engine. The engine continues to
  reject non-loopback endpoints before sending narration text.

**Rationale**: Read-ahead creates more request paths, so bypassing the existing validation would
  violate the local-first privacy guarantee. Keeping one validated boundary avoids duplicated URL
  policy logic.

**Alternatives considered**:

- Validate only at controller startup: rejected because the endpoint may change after startup.
- Add a second scheduler-level URL validator: rejected because duplicated policy can drift.
