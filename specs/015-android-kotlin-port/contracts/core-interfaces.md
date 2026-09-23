# Contracts: core ↔ platform seams

**Feature**: `015-android-kotlin-port` | **Phase**: 1 (design)

This app exposes no network or public API. Its contracts are the **seams between the pure `core`
module and the platform `app` module** — the interfaces `core` defines and `app` implements. They
matter because each seam is where a fake is substituted so the 53 ported behavior tests can run on
the JVM with no device.

Each contract below states the behavior implementers must satisfy, not their signatures — the tests
assert behavior, never call order or concrete types (Constitution Principle III).

---

## 1. TextSynthesizer (`core` defines, `app/speech` implements)

Turns one passage into playable audio.

**Contract**:

- Given a passage and narration settings, produces audio for the passage's `spokenText`.
- Reports how long preparation took, so the read-ahead scheduler can adapt (FR-010).
- Preparation is cancellable. A cancelled preparation produces no audio and no playback.
- Failure surfaces as `TTS_FAILED`, carrying no document text (A07).
- The same passage with different `rate` or `voiceId` is a **different** request — results are never
  interchangeable (FR-011).

**Why a seam**: lets the scheduler and controller tests run against a fake with programmable
latency, which is how User Story 3's bounded-depth behavior is verified without a speech engine.

---

## 2. ReadAheadScheduler (pure, in `core`)

Decides how far ahead to prepare and caches prepared audio.

**Contract**:

- Prepares between **1 and 6** passages ahead, never outside that range (FR-010).
- Depth is how many passages fit inside one passage's playback: it rises towards 6 as observed
  preparation speeds up, and falls to 1 as preparation slows. See research.md, "Read-ahead depth",
  for why this preserves the existing reader's behavior.
- Invalid or absent timing data floors the depth to 1 rather than throwing.
- A passage already prepared is reused without a second request (User Story 3, scenario 3).
- Cache identity includes passage id, voice, and rate (FR-011).
- A reset discards in-flight and cached preparation; nothing prepared before the reset may play.

---

## 3. EndpointValidator (pure, in `core`) — security-critical

Guards the developer-only narration endpoint (A08).

**Contract**:

- Accepts only loopback addresses.
- Rejects by **resolved address**, not string prefix — `localhost.evil.com`, credential-embedded
  authorities (`http://localhost@evil.com`), and non-loopback IPs are refused.
- Validation runs **before every request**, not once at configuration time.
- Rejection happens **before any document text is transmitted**.
- Redirects are not followed on the narration path.
- In release builds no remote endpoint exists at all; this contract is unreachable there (FR-016,
  FR-017).

---

## 4. DocumentTextSource (`core` defines, `app/pdf` implements)

Supplies positioned text for one page.

**Contract**:

- Returns text runs with positions normalised to 0..1 against the page box.
- A page with no readable text returns empty rather than throwing — the caller reports the document
  unreadable (FR-015).
- An encrypted document fails as `PDF_PASSWORD_REQUIRED` (A10).
- A malformed page fails as `TEXT_EXTRACTION_FAILED` for **that page only**; other pages stay
  readable (A10).
- Extraction never runs on the main thread.
- Returned text is untrusted and is never interpreted as markup (FR-019).

---

## 5. ProgressStore (`core` defines, `app/data` implements)

Persists where reading stopped.

**Contract**:

- Saves progress against a content-derived document identifier only.
- Restores progress **only** for a document whose content hashes to the same identifier (FR-013).
- Persists no filename, no extracted text, no document bytes (FR-018).
- Damaged or unreadable stored data is discarded; reading starts from the beginning (FR-014).
- A failed save never blocks narration.

---

## 6. AudioOutput (`core` defines, `app/speech` implements)

Plays prepared audio and reports completion.

**Contract**:

- Plays one passage's audio and signals when it finishes, so narration can advance (User Story 1,
  scenario 3).
- Pause and resume preserve position within the passage.
- Stop discards current audio; nothing already handed over may play afterwards.
- Loss of audio focus pauses playback and does **not** auto-resume (FR-012).

---

## Contract test strategy

Each contract gets behavior tests driven through a fake in `core`'s JVM test source set. The real
Android implementation in `app` is then verified against the same observable behaviors, on device,
only where the platform API makes JVM testing impossible.

No contract test asserts a constructor, a private method, internal state, a concrete type, or a call
sequence.
