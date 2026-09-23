# Feature Specification: Kokoro Narration for the Reader App

**Feature Branch**: `012-kokoro-reader-app-migration`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "Migrate Evangeline's PDF/EPUB listening reader to the rebuilt UI now living at evangeline/reader-app (a TanStack Start + React 19 app, code-named 'Auralis', copied in from a Grok App Builder workspace). The old vanilla-JS app in pdf-reader/ stays untouched and running side by side; reader-app becomes a new, independent product surface, not a replacement in place. Replace reader-app's browser-based TTS with a Kokoro-backed TTSEngine that calls the existing local Kokoro server, reused exactly as-is. Voice listing must surface Kokoro's real voices. Playback control semantics (pause/resume/stop) must behave equivalently to the current browser engine's contract. Governed by the repo's constitution, especially Local-First Privacy (loopback-only, validated per request) and Security Review as a Gate."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Listening with a real narration voice instead of the OS voice (Priority: P1)

A listener opens a document in the reader app, presses play, and hears a Kokoro-synthesized
voice read the current passage aloud — not whatever robotic or inconsistent voice their
operating system happens to ship. The listening experience (play, pause, resume, stop,
highlight-follows-narration) works exactly as it does today; only the voice quality and
source change.

**Why this priority**: This is the entire point of the migration — without it, the reader app
is just a UI reskin with no functional improvement over the browser's built-in voice.

**Independent Test**: Open a document, press play, and confirm audio plays using a Kokoro
voice (verifiable by checking the requested voice list originates from the local Kokoro
server, not `window.speechSynthesis`). Delivers value standalone: better narration quality
with no other feature required.

**Acceptance Scenarios**:

1. **Given** a document is loaded and the local Kokoro server is running, **When** the
   listener presses play, **Then** the current passage is synthesized and played using a
   Kokoro voice, and the on-screen highlight advances in sync with the audio.
2. **Given** narration is playing, **When** the listener presses pause, **Then** audio
   playback stops immediately and can be resumed from the same position.
3. **Given** narration is paused, **When** the listener presses resume, **Then** playback
   continues from where it left off without re-synthesizing or skipping audio.
4. **Given** narration is playing, **When** the listener presses stop (or navigates away from
   the passage), **Then** audio playback ends and no further audio from that passage plays.

---

### User Story 2 - Choosing a narration voice (Priority: P2)

A listener opens the voice selection control and sees a list of real Kokoro voices (not the
browser's installed OS voices). They pick one and future playback uses that voice.

**Why this priority**: Voice choice is a meaningful part of the listening experience, but the
app is still usable end-to-end with just a default voice (User Story 1) if this isn't done
yet.

**Independent Test**: Open the voice picker with no other narration in progress and confirm
the listed voices match the local Kokoro server's `/v1/audio/voices` response. Selecting a
voice and starting playback uses that voice.

**Acceptance Scenarios**:

1. **Given** the local Kokoro server is running, **When** the listener opens the voice
   picker, **Then** the list shown matches the voices reported by the local Kokoro server.
2. **Given** a voice is selected, **When** playback starts, **Then** the audio is synthesized
   using that voice.

---

### User Story 3 - Graceful behavior when the local voice server isn't available (Priority: P3)

A listener opens the reader app without the local Kokoro server running (e.g., they forgot to
start it, or it's still starting up). The app tells them narration isn't available right now
instead of silently failing, hanging, or crashing, and does not fall back to sending document
text anywhere off-device.

**Why this priority**: Important for a trustworthy experience and for upholding the privacy
guarantee, but the primary flows (User Stories 1–2) are the ones that make the feature worth
shipping; this hardens an edge case.

**Independent Test**: With the Kokoro server stopped, open a document and press play; confirm
a clear, non-crashing error state is shown and no network request for speech synthesis is
sent to any non-loopback address.

**Acceptance Scenarios**:

1. **Given** the local Kokoro server is not reachable, **When** the listener presses play,
   **Then** the app shows a clear message that local narration is unavailable rather than
   failing silently or hanging indefinitely.
2. **Given** the local Kokoro server is not reachable, **When** the app attempts to fetch
   voices or synthesize speech, **Then** no document text or audio request is sent to any
   destination other than a loopback address.

### Edge Cases

- What happens when the Kokoro server is reachable but returns an error (e.g., unknown voice,
  malformed request, internal synthesis failure) for a specific passage? The listener should
  see a clear failure state for that passage rather than the app getting stuck in a
  "buffering" state indefinitely.
- What happens when the listener rapidly presses play/pause/stop in succession? Playback
  state must remain consistent — no overlapping audio, no stuck "loading" indicator, no
  crash.
- What happens when the previously selected voice is no longer in the Kokoro server's voice
  list (e.g., server restarted with a different model)? The app must fall back to a valid
  default voice rather than failing to play at all.
- What happens when a passage of text is at or near the Kokoro server's maximum input length?
  Playback must either succeed or fail clearly, never silently truncate narrated content
  without indicating that it did so.
- What happens if the configured narration endpoint is not a loopback address (e.g., a
  misconfiguration points it at a remote host)? The request MUST be rejected before any text
  is sent, per the project's privacy guarantee.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The reader app MUST synthesize narration audio for the current passage using the
  local Kokoro voice server instead of the browser's built-in speech synthesis.
- **FR-002**: The reader app MUST retrieve the list of available narration voices from the
  local Kokoro voice server and present that list to the listener, instead of the browser's
  installed voice list.
- **FR-003**: Playback controls (play, pause, resume, stop) MUST produce the same observable
  behavior to the listener as they do today: pause halts audio immediately and resumably;
  resume continues from the same position without skipping or repeating audio; stop ends
  playback and prevents further audio from that passage.
- **FR-004**: The reading highlight MUST continue to stay in sync with spoken audio during
  playback, matching current behavior.
- **FR-005**: The reader app MUST validate that any local voice server endpoint it talks to is
  a loopback address (localhost/127.0.0.1) before sending any request, and MUST reject the
  request without transmitting document text if that check fails.
- **FR-006**: The reader app MUST NOT transmit document text to any non-loopback destination
  for the purpose of narration.
- **FR-007**: When the local voice server is unreachable, the reader app MUST present a clear,
  non-crashing message to the listener indicating narration is unavailable, rather than
  hanging or failing silently.
- **FR-008**: When the local voice server returns an error for a specific synthesis request,
  the reader app MUST surface a clear failure state for that passage rather than remaining in
  an indefinite loading/buffering state.
- **FR-009**: If a listener's previously selected voice is absent from the current voice list,
  the reader app MUST fall back to a valid default voice rather than failing to produce audio.
- **FR-010**: Rapid, repeated play/pause/stop actions MUST NOT result in overlapping audio,
  stuck loading indicators, or crashes.
- **FR-011**: The existing vanilla-JS reader (`pdf-reader/`) and its own local voice server
  usage MUST remain unaffected by this change — this feature is scoped entirely to the reader
  app.
- **FR-012**: This feature MUST NOT introduce or activate any account/sign-in or database
  functionality in the reader app.

### Key Entities

- **Narration Voice**: A selectable voice identity for synthesis, described by an identifier
  and a display name, sourced from the local voice server rather than the operating system.
- **Narration Segment**: A unit of on-screen text queued for synthesis and playback (unchanged
  from current behavior — this feature changes how a segment's audio is produced, not what a
  segment is).
- **Playback Session**: The current play/pause/resume/stop state for a document's narration,
  which must behave consistently regardless of which synthesis source produces the audio.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of narration playback in the reader app is produced by the local voice
  server; zero passages fall back to the browser's built-in speech synthesis.
- **SC-002**: Listeners can select from the local voice server's full set of offered voices,
  and every offered voice successfully produces audio when chosen.
- **SC-003**: Pause, resume, and stop each produce the expected outcome (halt, continue from
  same position, end playback) in 100% of manual verification passes across at least 10
  consecutive play/pause/resume/stop cycles.
- **SC-004**: When the local voice server is stopped, 100% of playback attempts show a clear
  unavailable-narration message within 5 seconds, with no hung/spinning state and no network
  request sent to a non-loopback address.
- **SC-005**: Zero document text is observed leaving the device to a non-loopback destination
  during any narration flow, verified by inspecting outgoing requests during testing.

## Assumptions

- The local Kokoro voice server (already running for the existing `pdf-reader/` app) is
  reused unchanged: same endpoints, same request/response shape, same default port
  conventions. This feature does not modify, move, or redeploy that server.
- "Loopback address" means `localhost`, `127.0.0.1`, or an equivalent local-only host; the
  reader app's narration endpoint configuration defaults to one of these and is validated
  before every request, consistent with the project's existing privacy principle.
- The reader app's existing narration segment structure, chunking, and highlight-sync logic
  are unchanged by this feature; only the component that turns a segment's text into audio
  changes.
- Voice IDs are opaque strings understood only by the local voice server; the reader app does
  not need to interpret or validate their internal meaning beyond checking they appear in the
  server's reported voice list.
- No new user-facing settings beyond voice selection are required for this feature (e.g., no
  new server address configuration UI) unless a later spec adds one.
