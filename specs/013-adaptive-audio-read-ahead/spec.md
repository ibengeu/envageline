# Feature Specification: Adaptive Audio Read-Ahead

**Feature Branch**: `013-adaptive-audio-read-ahead`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "Port the adaptive read-ahead optimization from the existing
`pdf-reader/` reader into `reader-app/`. Use recent synthesis timing to prefetch upcoming Kokoro
narration audio, reuse prefetched audio for playback, keep buffering bounded, and preserve current
segment highlighting, playback controls, loopback-only requests, and cancellation when the document
or playback session changes. Do not change the old reader."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Continuous narration (Priority: P1)

A listener plays a document in the new reader app. The reader prepares the current passage and
upcoming passages while the current passage plays, so normal playback does not wait for each
passage to finish synthesizing.

**Why this priority**: Continuous narration is the main user value of the optimization. It must
work before other refinements are useful.

**Independent Test**: Use a controlled local voice server and confirm that an upcoming passage is
requested before the current passage finishes and that playback uses the prepared audio.

**Acceptance Scenarios**:

1. **Given** a document has at least two readable passages, **When** the listener starts playback,
   **Then** the current passage and at least one upcoming passage can be prepared concurrently.
2. **Given** an upcoming passage was prepared successfully, **When** playback reaches that passage,
   **Then** the reader uses the prepared audio without sending a duplicate synthesis request.
3. **Given** the voice server responds at different speeds, **When** playback continues,
   **Then** the reader increases or decreases the amount of read-ahead within a bounded range.

### User Story 2 - Safe playback changes (Priority: P1)

A listener changes passages, starts a new document, pauses, stops, or changes narration settings
while read-ahead work is active. The reader keeps the visible highlight and spoken audio aligned.
The reader does not play audio from an old document, old playback session, voice, or rate.

**Why this priority**: Stale audio can make the reader speak the wrong document or make the
highlight disagree with the voice. This is a correctness and privacy requirement.

**Independent Test**: Start controlled read-ahead requests, change the document or playback
session, complete the old requests, and confirm that no old request changes the new playback state.

**Acceptance Scenarios**:

1. **Given** read-ahead requests are active, **When** the listener stops or changes the document,
   **Then** pending work is cancelled or ignored and cannot start playback.
2. **Given** the listener changes voice or rate, **When** the next passage plays, **Then** the
   passage uses the new setting and not audio prepared with the old setting.
3. **Given** an upcoming request fails, **When** the current passage is ready, **Then** current
   playback continues and the failed background request does not create a playback error.

### User Story 3 - Preserved reading behavior (Priority: P2)

A listener uses the reader's existing controls and highlighting while read-ahead is active. The
reader keeps the current segment highlight, pause and resume behavior, stop behavior, local-only
requests, and the old reader's behavior unchanged.

**Why this priority**: Read-ahead is an optimization. It must not change the reader's public
behavior or the old reader implementation.

**Independent Test**: Run the existing reader behavior tests and security tests with read-ahead
enabled, then inspect the old reader files for no changes.

**Acceptance Scenarios**:

1. **Given** a passage is being prefetched, **When** the listener pauses or resumes, **Then** the
   current audio pauses or resumes without moving the highlight to a prefetched passage.
2. **Given** an endpoint is not loopback, **When** read-ahead would request audio, **Then** the
   request is rejected before document text is sent.

### Edge Cases

- A document has fewer upcoming passages than the selected read-ahead amount.
- A synthesis request finishes after the listener has stopped or changed documents.
- The voice or rate changes while an old audio request is in flight.
- The local voice server fails for an upcoming passage but remains available for the current one.
- The current passage is already available while every upcoming request is slow or unavailable.
- The listener seeks backward to a passage that was previously prepared.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The reader MUST prepare at least one upcoming readable passage while the current
  passage is being prepared or played, when an upcoming passage exists.
- **FR-002**: The reader MUST use prepared audio when playback reaches the matching passage and
  MUST NOT issue a duplicate synthesis request for the same passage and narration settings.
- **FR-003**: The reader MUST adjust the number of upcoming passages it prepares from one through
  six based on recent local synthesis speed.
- **FR-004**: The reader MUST keep retained in-memory prepared audio bounded to the current
  playback window and MUST release or ignore audio that is behind the current passage.
- **FR-005**: The reader MUST prevent prepared audio from an old document, playback session, voice,
  or rate from starting playback after the active context changes.
- **FR-006**: A failed background preparation MUST NOT fail current playback. A failure for the
  current passage MUST use the existing clear narration error behavior.
- **FR-007**: Read-ahead MUST NOT change the segment boundary, segment highlight timing, or the
  behavior of play, pause, resume, stop, seek, and completion controls.
- **FR-008**: Every read-ahead synthesis request MUST use the existing loopback-only endpoint
  validation before document text is sent.
- **FR-009**: The existing `pdf-reader/` reader and its tests MUST remain unchanged by this
  feature.
- **FR-010**: The feature MUST NOT add a user-facing read-ahead setting or a new network service.

### Key Entities

- **Read-Ahead Window**: The current passage and the bounded set of upcoming passages prepared for
  playback.
- **Prepared Audio**: Audio generated for one passage and one narration settings combination.
- **Synthesis Timing Estimate**: A recent conservative estimate used to choose the read-ahead
  window size.
- **Playback Context**: The active document, playback session, voice, and rate that determine
  whether prepared audio is valid.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In controlled playback tests with at least two passages, the next passage request
  starts before the current passage completes in 100% of eligible runs.
- **SC-002**: A prepared passage is synthesized at most once for each combination of passage,
  voice, and rate during one active playback context.
- **SC-003**: Read-ahead never retains more than six upcoming passages plus the current passage in
  the active in-memory window.
- **SC-004**: Across document changes, seeks, stops, voice changes, and rate changes, zero stale
  prepared passages start playback in the behavior test suite.
- **SC-005**: All relevant existing playback, highlighting, cancellation, and loopback security
  tests continue to pass.

## Assumptions

- The feature targets the existing `reader-app/` local Kokoro flow.
- The current narration segment boundaries remain unchanged. Merging segments is out of scope
  because it can change highlight behavior.
- Read-ahead is session-scoped in this feature. Persistent audio storage is out of scope.
- The existing Kokoro server and loopback endpoint remain unchanged.
- The reader uses the existing playback error and control states.
