# Feature Specification: PDF Processing Foundations (Rules & Capability Detection)

**Feature Branch**: `002-pdf-processing-foundations`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: a 23-epic, ~140-feature "Browser PDF Processor" breakdown covering
environment constraints, capability detection, worker topology, message protocol, local
persistence, a processing state machine, ten pipeline stages (fingerprinting through reader-AST
assembly), output validation, error handling, resource management, privacy/security,
diagnostics, and testing. Per user direction, this spec covers only **Epic 1 (Environment and
Constraints)** and **Epic 2 (Browser Capability Detection)** — the two epics with no
dependencies that gate everything else in the source document. Epics 3–23 are explicitly out of
scope for this spec and are not pre-approved; each would need its own scope-fit check against
the product constitution before being specified.

**Scope note (constitution fit)**: The full 23-epic source document describes a general-purpose,
standalone PDF processing platform — including OCR, a semantic document AST, multi-worker
topology, and checkpoint/resume persistence — which is broader than this product's constitution
(Principle II, Narrow Product Surface: "Evangeline does one job: turn a document into a good
listening experience," and OCR is explicitly named as out of scope elsewhere in this project's
history). This spec's actual scope — explicit, testable rules for local-only processing and
capability-aware feature gating — passes the constitution's "does this make a document better to
listen to" test on its own merits: it protects the privacy guarantee and lets extraction degrade
gracefully instead of failing unpredictably across browsers. It does **not** constitute approval
of Epics 3–23; each of those (worker topology, OCR, semantic classification, etc.) would need
its own constitution-fit review before being turned into a spec.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Document processing never leaves the device (Priority: P1)

A user opens a PDF or EPUB to have it read aloud. Regardless of which processing path is used
(current or future), the document's bytes and any data extracted from it must never be sent
anywhere off the user's device unless the user takes an explicit, separate action (such as an
export or sync feature) that does not exist yet and is not part of this feature.

**Why this priority**: This is the product's core, non-negotiable trust guarantee (constitution
Principle I). Every other rule in this spec exists to protect this one; if this rule is wrong,
nothing else matters.

**Independent Test**: Load a document and observe all network activity during processing.
Confirm no document bytes, extracted text, or derived data are transmitted anywhere.

**Acceptance Scenarios**:

1. **Given** a user has loaded a document, **When** processing runs, **Then** no document bytes,
   extracted text, or derived processing data are sent over the network.
2. **Given** a future feature adds an export or sync capability, **When** that feature is
   evaluated, **Then** it is treated as a separate, explicitly opt-in feature outside this
   processing pipeline, not a side effect of normal document loading.

---

### User Story 2 - The original document is never altered (Priority: P1)

A user's source PDF or EPUB file is treated as read-only throughout processing. No stage of
extraction or analysis modifies the original file the user provided.

**Why this priority**: Users trust that opening a document for listening cannot corrupt or
change their file. This is a basic data-safety guarantee, independent of privacy.

**Independent Test**: Load a document, run it through processing, and confirm the original file
(by content, not just by filename) is byte-for-byte identical to what was provided.

**Acceptance Scenarios**:

1. **Given** a user provides a document, **When** any processing stage runs, **Then** the
   original file's bytes are never modified, only read.

---

### User Story 3 - The same document always produces the same result (Priority: P2)

A user reopens the same document later, possibly after the app has been updated. Processing the
identical file with the identical settings produces an identical result every time — the same
document should not sound different or extract differently from one session to the next unless
something about the document, the app's processing logic, or the user's chosen settings actually
changed.

**Why this priority**: Predictability builds trust and makes debugging/support possible, but it
matters less on its own than the privacy and integrity guarantees above — it's a quality
property, not a safety one.

**Independent Test**: Process the same document twice, with the same settings, on the same app
version, and confirm the results are identical. Change one input (e.g. a processing setting) and
confirm the result changes accordingly, in a way attributable to that specific change.

**Acceptance Scenarios**:

1. **Given** a document, a set of processing settings, and a specific version of the app's
   processing logic, **When** the document is processed twice under those identical conditions,
   **Then** the result is identical both times.
2. **Given** a previously processed document, **When** the app's processing logic or the user's
   settings change, **Then** any resulting difference in output is attributable to that specific
   change, not to unexplained variation.

---

### User Story 4 - Heavy processing never freezes the app (Priority: P1)

While a document is being processed — especially a large one — the user can still interact with
the app: scroll, click controls, and see progress. The interface does not lock up or become
unresponsive while extraction or analysis is running.

**Why this priority**: An unresponsive app during processing is one of the most common ways
users lose trust in a tool and abandon it mid-task; this is a baseline usability guarantee for
any processing-heavy feature.

**Independent Test**: Load a large document and confirm the interface remains responsive
(scrollable, clickable) throughout processing, with visible progress feedback.

**Acceptance Scenarios**:

1. **Given** a document is being processed, **When** the user interacts with the app (scrolling,
   clicking a button), **Then** the app responds without a noticeable freeze.
2. **Given** processing of a large document, **When** the user watches the interface, **Then**
   they see ongoing progress feedback rather than an indefinite unresponsive state.

---

### User Story 5 - The app adapts to what the user's browser can actually do (Priority: P2)

Before processing begins, the app determines what the current browser and device actually
support (such as background processing, local file storage, and hardware-accelerated
capabilities) and adjusts its behavior accordingly — using better-performing approaches where
available, falling back to simpler ones where not, and clearly telling the user when a document
cannot be processed reliably at all rather than silently producing a degraded or broken result.

**Why this priority**: This makes the rest of the system trustworthy across the range of
real-world browsers users actually have, but it is an enabling capability rather than a
user-facing guarantee in its own right — it matters because of what it protects (reliable
processing), which is why it ranks below the core trust and responsiveness guarantees.

**Independent Test**: Run the app in a browser/environment missing a capability the current
processing path depends on for large documents, and confirm the user sees a clear message
rather than a silent failure, a hang, or corrupted output. Run it in a fully capable
environment and confirm better-performing paths are used automatically.

**Acceptance Scenarios**:

1. **Given** a browser environment that lacks a capability required for processing a large
   document reliably, **When** the user attempts to process such a document, **Then** they see
   a clear explanation rather than a silent failure or a hang.
2. **Given** a browser environment that lacks a capability required only for an optional
   performance improvement, **When** processing runs, **Then** the app falls back to a simpler
   approach automatically, without blocking the user or requiring them to do anything.
3. **Given** a browser environment with all relevant capabilities available, **When**
   processing runs, **Then** the app is able to use the better-performing approach without the
   user needing to configure anything.
4. **Given** an environment where a capability appears to be present but is known to actually be
   a slower or non-functional substitute (a "fake" version of that capability), **When** this is
   detected, **Then** the app treats it as if the real capability were unavailable rather than
   assuming it works normally.

---

### Edge Cases

- What happens when a document is small enough that a missing capability wouldn't meaningfully
  affect the user (e.g., a one-page document on a browser lacking background-processing
  support)? Processing MUST still be allowed to proceed for small documents even when a
  capability normally required for large documents is missing, rather than blocking every
  document outright.
- What happens when capability detection itself is inconclusive or the check fails partway
  through? The system MUST treat an inconclusive result as "capability not confirmed available"
  (the conservative case) rather than assuming the capability exists.
- What happens when the user's browser changes mid-session (e.g., a permission is revoked, or a
  hardware resource becomes unavailable) after capability detection already ran? This spec
  covers detection at the start of processing; re-detecting capabilities mid-session is not
  required by this feature, but a processing failure caused by a capability disappearing
  mid-way MUST still fail clearly rather than corrupt output silently (per the general error
  guarantee already expected of any processing step).
- What happens if two different capabilities conflict (one suggests a fast path is available,
  another suggests it is not)? The system MUST resolve such conflicts conservatively — never
  choosing a path whose required capabilities are not all confirmed present.

## Requirements *(mandatory)*

### Functional Requirements

**Local-only processing (Epic 1)**

- **FR-001**: System MUST NOT transmit document bytes, extracted text, or any data derived from
  a loaded document to any network destination during normal processing.
- **FR-002**: System MUST treat any future export, sync, or sharing capability as a separate,
  explicitly user-initiated feature outside the scope of normal document processing, never as an
  automatic side effect of loading or processing a document.

**Byte preservation (Epic 1)**

- **FR-003**: System MUST treat the user's original source file as read-only throughout every
  processing stage; no stage may write to or otherwise alter the original file's bytes.

**Reproducibility (Epic 1)**

- **FR-004**: System MUST produce identical processing results for the identical document,
  identical user-chosen settings, and identical version of the app's processing logic.
- **FR-005**: System MUST ensure that any difference in output between two processing runs is
  attributable to a specific, identifiable change (a different document, a different setting,
  or a different version of the processing logic) rather than unexplained variation.

**Main-thread responsiveness (Epic 1)**

- **FR-006**: System MUST keep the user interface responsive (able to accept scrolling and
  input, and to show progress) while a document is being processed, regardless of document size.

**Capability detection (Epic 2)**

- **FR-007**: System MUST determine, before processing a document, which relevant browser and
  device capabilities are actually available in the current environment.
- **FR-008**: System MUST identify a minimum set of capabilities required to reliably process
  large documents, and MUST clearly inform the user — rather than silently failing, hanging, or
  producing corrupted results — when attempting to process a large document without them.
- **FR-009**: System MUST allow processing of small documents to proceed even when a capability
  normally required only for large documents is missing, rather than blocking all processing
  outright whenever any capability is absent.
- **FR-010**: System MUST detect when a capability that appears to be present is actually a
  non-functional or significantly degraded substitute, and MUST treat that case the same as the
  capability being unavailable.
- **FR-011**: System MUST automatically use better-performing processing approaches when their
  required capabilities are confirmed available, and MUST automatically fall back to simpler
  approaches when they are not, without requiring the user to configure this manually.
- **FR-012**: System MUST treat an inconclusive or failed capability check as "not confirmed
  available" rather than assuming the capability exists.

### Key Entities

- **Processing Rule**: One of the four non-negotiable constraints from Epic 1 (local-only,
  byte-preservation, reproducibility, main-thread responsiveness) that every current and future
  processing feature must satisfy. Not a data entity — a governing constraint checked against
  design and implementation decisions, similar in spirit to the project's existing constitution
  principles.
- **Capability Assessment**: The result of checking what the current browser/device environment
  actually supports, at the point processing begins for a given document. Used to decide which
  processing path is available (better-performing vs. fallback) and whether processing can
  proceed at all for a document of the size being loaded. Not persisted between sessions — a
  fresh assessment is made each time processing starts, since a user could be on a different
  device or browser state than last time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0% of network requests observed during document processing carry document bytes,
  extracted text, or derived processing data, across all supported browsers.
- **SC-002**: 100% of documents processed leave their original source file byte-for-byte
  unchanged, verified by comparing the file before and after processing.
- **SC-003**: Processing the same document with the same settings on the same app version
  produces identical results in 100% of repeated trials.
- **SC-004**: A user can continue to interact with the app (scroll, click) throughout processing
  of a large document, with no single unresponsive period long enough for the user to perceive
  the app as frozen.
- **SC-005**: 100% of attempts to process a large document in an environment missing a required
  capability result in a clear message to the user, with 0% resulting in a silent failure, an
  indefinite hang, or corrupted output.
- **SC-006**: 100% of attempts to process a small document succeed regardless of which optional
  capabilities are present, so long as the minimum small-document requirements are met.

## Assumptions

- "Large document" and "small document" are relative to whatever size threshold makes a missing
  capability meaningfully risky; this spec does not fix an exact byte or page-count threshold —
  that is a defensible implementation detail for a future plan, not a business rule this spec
  needs to pin down.
- This spec's scope is intentionally limited to Epic 1 and Epic 2 of the larger source document,
  per explicit user direction. Epics 3–23 (worker topology, message protocol, local persistence,
  the ten-stage processing pipeline, output validation, error handling, resource management,
  privacy/security beyond Epic 1's rules, diagnostics, and testing) are out of scope for this
  spec and are not implicitly approved by it.
- The existing product's current processing approach (synchronous, single-threaded PDF.js
  extraction in `pdf-reader/app.js`) already satisfies User Stories 1–4 in practice (no network
  calls, no file mutation, deterministic normalization functions, and a document size small
  enough in current usage that main-thread work hasn't been a reported problem) but does not yet
  perform any formal capability detection (User Story 5) — that is the net-new behavior this
  spec introduces.
- Capability detection covers whatever specific capabilities a future plan identifies as
  relevant (e.g., background processing support, local file storage, hardware-accelerated
  rendering) — this spec does not enumerate an exact capability list, since that is an
  implementation detail belonging to the plan, not a business requirement.
- OCR, semantic document classification, and the full reader-AST pipeline described in later
  epics of the source document are explicitly not part of this spec's scope and remain subject
  to their own constitution-fit review (see Scope note above) before being specified.
