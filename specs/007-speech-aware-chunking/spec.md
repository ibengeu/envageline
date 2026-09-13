# Feature Specification: Speech-Aware Chunking

**Feature Branch**: `007-speech-aware-chunking`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: fourth subsystem of a multi-spec effort to evolve the existing Smart
PDF Reading pipeline (`pdf-reader/app.js`, from specs 001-006) toward the "PDF → structured
spoken-document representation" architecture described in a full system design document (Mobile
PDF-to-Speech Reader). Today `splitIntoSpeechChunks` divides narration text into TTS-bound chunks
using a sentence-boundary regex that splits after any period regardless of context. Two confirmed,
reproducible defects: (1) "Dr. Smith found..." splits into "Dr." and "Smith found...", producing
an unnatural pause as if "Dr" were a complete sentence; (2) a decimal-shaped or normalized
multi-word numeric phrase can be fractured across a chunk boundary (e.g. "3.14" splitting into
"3." and "14..."), causing a number to be read as two separate numbers. This spec fixes the
chunker to respect semantic and entity boundaries — paragraph, then sentence, then clause, then
plain punctuation — while never splitting inside a known abbreviation-plus-period, a decimal
number (raw or already spoken-form-normalized by spec 006), a currency amount's spoken form, an
ordinal, or a title-plus-name pair. No new block classification, no new UI controls, no network
calls, no change to specs 004-006's classification/policy/normalization logic — this operates
purely on already-normalized narration text, changing only how it is divided into chunks.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Abbreviations don't create false sentence breaks (Priority: P1)

A listener hears "Dr. Smith found that..." read as one continuous, natural phrase, not as two
disconnected fragments with an unnatural pause after "Dr" as if it were a complete sentence on
its own.

**Why this priority**: This is the single most common false-positive pattern in sentence-boundary
detection over real prose — titles, honorifics, and common abbreviations appear constantly in the
kinds of documents this reader targets (reports, articles, books), and every occurrence currently
produces an audibly broken reading. Fixing this is the primary, confirmed defect motivating this
spec.

**Independent Test**: Process narration text containing a known abbreviation (Dr., Mr., Mrs.,
Prof., vs., approx., etc., e.g., i.e., St., Jr., Sr.) immediately followed by a capitalized word,
and confirm the chunker does not split between the abbreviation and the following word.

**Acceptance Scenarios**:

1. **Given** narration text "Dr. Smith found that the results were conclusive.", **When** it is
   chunked, **Then** "Dr. Smith" appears together within one chunk, never split between "Dr." and
   "Smith".
2. **Given** narration text containing "the U.S. economy grew, according to Prof. Lee, who noted
   the trend.", **When** chunked, **Then** neither "Prof. Lee" nor a recognized abbreviation is
   split across a chunk boundary.
3. **Given** narration text with an ordinary sentence-ending period followed by a new sentence
   starting with a capitalized word (no abbreviation involved), **When** chunked, **Then** the
   chunker still splits at that ordinary sentence boundary as it does today — abbreviation
   protection must not suppress genuine sentence breaks.

---

### User Story 2 - Numbers and currency amounts are never split mid-value (Priority: P1)

A listener hears "three point one four" or "four hundred dollars" read as one uninterrupted
phrase, never split partway through so that a single number is heard as two unrelated numbers or
a currency amount is heard as an amount followed by a disconnected unit word.

**Why this priority**: This is the second confirmed defect and directly undermines spec 006's own
purpose — a number correctly normalized into natural spoken words is worthless if the chunker
then fractures it back into a confusing reading. Ranked P1 alongside User Story 1 because both are
the two specifically confirmed, reproducible defects this spec exists to fix.

**Independent Test**: Process narration text containing a normalized multi-word numeric phrase
(e.g. "three point one four", "four hundred dollars", "twenty twenty-four") positioned near a
chunk-length boundary, and confirm the phrase is never split across two chunks; separately,
process text where a raw, not-yet-normalized decimal number could still reach the chunker (a
defensive case) and confirm the same protection applies.

**Acceptance Scenarios**:

1. **Given** narration text containing "the value of pi is three point one four in this
   context.", **When** chunked at a length that would otherwise fall in the middle of that
   phrase, **Then** "three point one four" appears together within one chunk.
2. **Given** narration text containing "the device costs four hundred dollars and lasted two
   years.", **When** chunked, **Then** "four hundred dollars" is never split between "four
   hundred" and "dollars".
3. **Given** narration text containing a raw decimal number such as "3.14" (not yet converted to
   words), **When** chunked, **Then** the chunker does not split between the digits before and
   after the decimal point.
4. **Given** narration text containing an ordinal ("twenty-first") or a spoken year ("twenty
   twenty-four") positioned near a chunk-length boundary, **When** chunked, **Then** the complete
   phrase stays within one chunk.

---

### User Story 3 - Chunking still respects length limits and existing behavior (Priority: P2)

A developer or listener relying on the existing chunk-length bound (so no single request to the
TTS engine becomes too large) sees that bound still respected after this fix, and a document with
none of the abbreviation/number edge cases chunks exactly as it did before this spec.

**Why this priority**: This is the safety net ensuring the precision fix doesn't regress the
chunker's core job (bounding request size) or change behavior for the common case that was
already correct. Ranked P2 because it's a non-regression guarantee rather than new user-facing
value — nothing in User Stories 1-2 works without it holding, but it doesn't independently justify
the spec on its own.

**Independent Test**: Process a long passage of plain prose with none of the protected patterns
and confirm chunk boundaries and content are byte-for-byte identical to the pre-fix chunker's
output; separately, construct a passage where a protected span itself would need to be split to
respect the length bound, and confirm the fallback split happens without crashing or producing an
unbounded chunk.

**Acceptance Scenarios**:

1. **Given** a long passage of plain prose containing only ordinary sentence-ending periods and no
   abbreviations, decimals, currency amounts, or ordinals, **When** chunked with the same length
   bound as before, **Then** the resulting chunks are identical to the pre-fix chunker's output
   for that passage.
2. **Given** a chunk-length bound smaller than a single protected span's own length (a
   pathological case), **When** chunked, **Then** the chunker still produces chunks (falling back
   to splitting through the protected span as a last resort) rather than crashing, looping
   indefinitely, or emitting one unbounded chunk.
3. **Given** narration text that needs to split at some point to respect the length bound, but a
   later boundary type (sentence) would exceed the bound while an earlier, non-preferred boundary
   type (clause) would not, **When** chunked, **Then** the chunker prefers the highest-priority
   boundary that still respects the length bound over one that doesn't, per the priority order
   paragraph > sentence > clause > plain punctuation.

### Edge Cases

- What happens when an abbreviation from the protected list appears at the very end of a block of
  text with nothing following it (no capitalized word to check)? It is not treated as requiring
  protection in that position, since there's nothing after it that could be wrongly merged or
  split — the protection rule only applies when the abbreviation is followed by further text.
- What happens when "St." is followed by a capitalized word — is it "Street" or "Saint"? This
  spec does not need to resolve that ambiguity (it doesn't change what is spoken, only where
  chunk boundaries fall); both readings equally require not treating the following period as a
  sentence break, so the protection applies uniformly regardless of which meaning is intended.
- What happens to a decimal or currency phrase that spans a paragraph boundary in the original
  text (a genuinely rare pathological input)? Paragraph boundaries remain the highest-priority,
  always-preferred split point per the stated priority order; this spec does not need to detect or
  prevent that specific pathological case, since it would require the source document itself to
  break a number across paragraphs, which is not a scenario normalization or chunking can
  reasonably second-guess.
- What happens when maxLength is smaller than even the shortest protected span (e.g. an
  unreasonably small configured limit)? Per User Story 3's acceptance scenario, the chunker falls
  back to splitting through the span rather than looping or producing an unbounded chunk — this
  is an explicit last resort, not silent data loss.
- What happens to the existing paragraph-join behavior (blocks are joined with `\n\n` before
  chunking)? Paragraph boundaries remain the top-priority split point, unchanged from today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The chunker MUST choose split points in this priority order when dividing narration
  text: paragraph boundary, then sentence boundary, then clause boundary (comma or semicolon),
  then plain punctuation — preferring the highest-priority boundary type that keeps each
  resulting chunk within the configured length bound.
- **FR-002**: The chunker MUST NOT treat a period as a sentence boundary when it immediately
  follows one of a defined set of common abbreviations (Dr., Mr., Mrs., Prof., vs., approx.,
  etc., e.g., i.e., St., Jr., Sr.) and is immediately followed by further text.
- **FR-003**: The chunker MUST NOT split narration text in the middle of a decimal number,
  whether the number is still in raw digit form (e.g. "3.14") or has already been converted to
  its multi-word spoken form by normalization (e.g. "three point one four").
- **FR-004**: The chunker MUST NOT split narration text in the middle of a currency amount's
  spoken form (e.g. "four hundred dollars", "one dollar and fifty cents").
- **FR-005**: The chunker MUST NOT split narration text in the middle of a spoken ordinal (e.g.
  "twenty-first") or a spoken year phrase (e.g. "twenty twenty-four").
- **FR-006**: The chunker MUST NOT split narration text between a protected title/honorific
  abbreviation and the name or word immediately following it (e.g. "Dr. Smith", "Prof. Lee").
- **FR-007**: The chunker MUST continue to respect a configurable maximum chunk length, splitting
  further whenever a candidate chunk would otherwise exceed it.
- **FR-008**: When no available split point above the length bound satisfies both the length
  constraint and the protected-span rules (FR-002 through FR-006), the chunker MUST fall back to
  splitting through the protected span or plain text as a last resort, rather than failing,
  looping indefinitely, or producing a chunk with no length bound at all.
- **FR-009**: For narration text containing none of the protected patterns (no abbreviations,
  decimals, currency amounts, ordinals, or spoken years), the chunker MUST produce output
  identical to its pre-fix behavior for the same input and length bound.
- **FR-010**: This feature MUST NOT introduce any new block-type detection, speech-policy change,
  or text-normalization change from specs 004-006; it operates only on the narration text those
  subsystems already produce.
- **FR-011**: This feature MUST NOT modify `index.html`, `styles.css`, or any reader control —
  chunking is an internal pipeline step with no user-facing settings surface introduced by this
  spec.

### Key Entities *(include if feature involves data)*

- **Protected Span**: A contiguous range of narration text that must never be split by a chunk
  boundary — an abbreviation-plus-following-word pair, a decimal number (raw or spoken-form), a
  currency amount's spoken phrase, an ordinal, or a spoken year phrase. Distinct from a
  `NormalizedEntity` (spec 006): a protected span is a chunking-time boundary constraint derived
  by re-scanning already-normalized text, not a value carried forward from normalization itself.
- **Split Point**: A candidate location in narration text where a chunk boundary may be placed,
  tagged with its priority tier (paragraph, sentence, clause, plain punctuation).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the existing behavioral test suite (173 tests as of spec 006) continues to
  pass unmodified after this feature, with no pre-existing test needing rewriting to tolerate a
  behavior change.
- **SC-002**: For narration text containing each documented protected-span pattern (abbreviation
  pairs, raw and spoken-form decimals, currency phrases, ordinals, spoken years), 100% of test
  cases show the protected span appearing intact within a single chunk, never split across two.
- **SC-003**: For a representative long passage of plain prose containing none of the protected
  patterns, chunking output is byte-for-byte identical to the pre-fix chunker's output for the
  same input and length bound.
- **SC-004**: A pathological input (a length bound smaller than the shortest protected span)
  produces bounded, terminating output rather than an infinite loop, a crash, or an unbounded
  chunk, in 100% of tested cases.
- **SC-005**: When a higher-priority boundary type would exceed the length bound but a
  lower-priority one would not, the chunker selects the boundary that satisfies the length bound,
  verified across all four priority tiers.

## Assumptions

- The abbreviation list (Dr., Mr., Mrs., Prof., vs., approx., etc., e.g., i.e., St., Jr., Sr.) is
  fixed for this spec, matching the examples given in the feature description; a user-extensible
  or document-specific abbreviation dictionary (as hinted at in the broader goal architecture's
  pronunciation-dictionary concept) is out of scope and deferred to a future spec.
- "Currency amount's spoken form" and "spoken year phrase" protection is implemented by
  re-recognizing the same natural-language patterns spec 006's converters produce (e.g. a
  number-word followed by "dollars"/"pounds"/"euros", or two number-words forming a year-shaped
  reading) directly in narration text at chunking time, not by threading structured entity
  metadata through from spec 006 — the chunker operates on plain narration text as its only
  input, consistent with today's `splitIntoSpeechChunks(text, maxLength)` signature.
- "Person's title-plus-name pair" (mentioned in the feature description) is covered by FR-006's
  abbreviation-plus-following-word protection; no separate name-detection logic (e.g.
  distinguishing a proper name from an ordinary capitalized word) is introduced, since the
  abbreviation-adjacency rule alone is sufficient to prevent the false split without needing to
  identify names specifically.
- No change to `mapParagraphsToChunks` (the existing paragraph-to-chunk matching used for
  click-to-jump navigation) is required by this spec, since chunk content changes only in exactly
  the cases described above (fixing incorrect splits), and that function already tolerates
  imperfect text alignment via word-overlap scoring.
