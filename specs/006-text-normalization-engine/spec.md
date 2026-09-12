# Feature Specification: Text Normalization Engine

**Feature Branch**: `006-text-normalization-engine`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: third subsystem of a multi-spec effort to evolve the existing Smart
PDF Reading pipeline (`pdf-reader/app.js`, from specs 001-005) toward the "PDF → structured
spoken-document representation" architecture described in a full system design document (Mobile
PDF-to-Speech Reader). Today, narration text is produced by joining spoken block text and
stripping only citation markers and bare URLs — numbers, currency, years, percentages, and
ordinals are narrated exactly as printed, which a downstream TTS engine will mispronounce or read
digit-by-digit. This spec adds a deterministic normalization step, between speech-policy filtering
and chunking, that produces spoken text distinct from (never overwriting) each block's original
text — no LLM, no paraphrasing, no change to a numeric value's meaning. No new block classification
logic, no new UI controls, no network calls, no chunking changes — this operates purely on
already-classified, already-policy-filtered block text.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Numbers sound like numbers, not digits (Priority: P1)

A listener hears "The device costs four hundred dollars" instead of "The device costs dollar four
zero zero" or a raw digit-by-digit reading, whenever a document contains an ordinary written
number, whether or not it involves currency.

**Why this priority**: This is the single most common and most jarring failure mode of a
generic screen reader compared to a professionally narrated audiobook — it's the core reason this
subsystem exists. Every other normalization category (years, percentages, ordinals) is a variant
of "read this numeric span the way a person would say it," so getting plain cardinal and currency
conversion right is the foundation the rest builds on.

**Independent Test**: Process a document containing plain cardinal numbers (e.g. "400",
"12,500", "1,000,000") and currency amounts (e.g. "$400", "$1.50", "£400", "€400", "$4m",
"$2.5bn") and confirm the narration text contains their natural spoken-word form instead of the
printed digits/symbols, while the document's displayed text is completely unchanged.

**Acceptance Scenarios**:

1. **Given** a block of narratable text containing "The device costs $400.", **When** the
   document is narrated, **Then** the spoken text reads "The device costs four hundred dollars."
   while the displayed text still reads "The device costs $400."
2. **Given** narratable text containing "Revenue reached $4m in sales.", **When** narrated,
   **Then** the spoken text reads "Revenue reached four million dollars in sales."
3. **Given** narratable text containing "The population is 12,500.", **When** narrated, **Then**
   the spoken text reads "The population is twelve thousand five hundred." — never "one two five
   zero zero" and never digit-by-digit.
4. **Given** narratable text containing a phone number or an explicitly labeled code (e.g. "PIN
   4829" or "+234 801 234 5678"), **When** narrated, **Then** the spoken text reads each digit
   individually ("PIN four eight two nine"), not as a cardinal number.

---

### User Story 2 - Years sound like years, not large numbers (Priority: P1)

A listener hears "nineteen ninety-eight" for "1998" and "twenty twenty-four" for "2024", not
"one thousand nine hundred ninety-eight" or a digit-by-digit reading — matching how a person
naturally speaks a year.

**Why this priority**: Years appear extremely frequently in the kinds of documents (reports,
books, articles) this reader targets, and reading a year as a generic large cardinal is
immediately and specifically wrong-sounding in a way that undermines the "professionally narrated
audiobook" goal. Ranked alongside User Story 1 as foundational, but separated because it requires
its own disambiguation logic distinct from plain cardinal conversion.

**Independent Test**: Process a document containing bare 4-digit numbers in typical year-bearing
sentences (e.g. "founded in 1998", "the 2024 report") and confirm they're narrated as years, while
a 4-digit number in a context that signals it is a plain count or quantity (e.g. "1500 units
sold") is narrated as an ordinary cardinal instead.

**Acceptance Scenarios**:

1. **Given** narratable text containing "The project began in 1998.", **When** narrated, **Then**
   the spoken text reads "The project began in nineteen ninety-eight."
2. **Given** narratable text containing "Revenue increased in 2024.", **When** narrated, **Then**
   the spoken text reads "...in twenty twenty-four."
3. **Given** narratable text containing "The year 2000 was significant.", **When** narrated,
   **Then** the spoken text reads "The year two thousand was significant."
4. **Given** narratable text containing "1500 units were sold.", **When** narrated, **Then** the
   spoken text reads "One thousand five hundred units were sold." — not read as a year, because
   the following word ("units") signals a plain quantity rather than a date.
5. **Given** narratable text containing "$1998 was the price.", **When** narrated, **Then** the
   number is narrated as a currency amount ("one thousand nine hundred ninety-eight dollars"),
   never as a year, because a currency symbol immediately precedes it.

---

### User Story 3 - Percentages, decimals, and ordinals sound natural (Priority: P2)

A listener hears "twenty percent", "three point one four", and "twenty-first" for "20%", "3.14",
and "21st" respectively, rather than symbol names or literal digit sequences.

**Why this priority**: These are common but appear less frequently per document than plain
numbers and years (User Stories 1-2), and a wrong reading of a percentage or ordinal, while
noticeable, is less disruptive to comprehension than a mis-spoken currency amount or year. Ranked
P2 because the foundation (numeric-span detection before conversion) built for User Stories 1-2
is what makes this category straightforward to add correctly.

**Independent Test**: Process a document containing percentages, standalone decimals, and
ordinal numbers and confirm each is narrated in its natural spoken form, distinct from how a
plain cardinal or year would be read.

**Acceptance Scenarios**:

1. **Given** narratable text containing "an increase of 20%.", **When** narrated, **Then** the
   spoken text reads "an increase of twenty percent."
2. **Given** narratable text containing "a rate of 0.5%.", **When** narrated, **Then** the spoken
   text reads "a rate of zero point five percent."
3. **Given** narratable text containing "the value of pi, 3.14,", **When** narrated, **Then** the
   spoken text reads "the value of pi, three point one four,".
4. **Given** narratable text containing "the 21st century.", **When** narrated, **Then** the
   spoken text reads "the twenty-first century."
5. **Given** narratable text containing "the 1st and 2nd items.", **When** narrated, **Then** the
   spoken text reads "the first and second items."

### Edge Cases

- What happens to a number inside a block type the speech policy has already excluded from
  narration (e.g. a page number, a footnote)? Normalization never runs on excluded block text —
  it only operates on text that speech-policy filtering (spec 005) has already selected to speak,
  consistent with this spec's position in the pipeline (after policy filtering, before chunking).
- What happens when a 4-digit number in the year-eligible range (1000-2099) is immediately
  preceded by a currency symbol or immediately followed by a unit/count word (e.g. "units",
  "items", "pages", "dollars")? It is treated as a plain cardinal or currency amount, not a year —
  the nearby context word overrides the bare range heuristic, per User Story 2's disambiguation
  requirement.
- What happens to a digit sequence with no explicit code/phone signal (no label word like "PIN",
  "code", "ext", "ID", or "#", and no phone-like internal dashes/spacing), even if it is very
  long? It is still converted as a plain cardinal number, never split digit-by-digit — this spec
  deliberately favors under-detecting codes over misreading a genuinely large plain number
  (e.g. a large population or budget figure) digit-by-digit.
- What happens to a decimal number that has already been classified as a percentage or currency
  amount? It is normalized once, using that more specific category's spoken form (e.g. "$1.50" is
  spoken as currency-with-cents, never additionally as a generic decimal "one point five zero
  dollars").
- What happens to a number the engine cannot confidently classify into any known category (an
  unusual symbol combination, a malformed number)? The number's original printed text is left
  unmodified in the spoken text rather than guessed at or dropped — normalization must never
  produce a plausible-sounding but wrong reading when it lacks confidence, and must never remove
  content from the spoken text as a side effect of failing to classify it.
- What happens to a currency symbol/code this spec does not support (e.g. ₦, ¥, or a 3-letter
  currency code like "USD")? It is left as printed text in the spoken output for this spec — full
  currency-symbol/code coverage beyond $, £, € is deferred, tracked as a known gap rather than
  silently mishandled.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The pipeline MUST produce a spoken-text form for each narratable block's text,
  distinct from and never overwriting that block's original text.
- **FR-002**: Normalization MUST run only on text that speech-policy filtering has already
  selected to be spoken (per spec 005); it MUST NOT process the text of a block the policy has
  excluded from narration.
- **FR-003**: The normalizer MUST convert a plain cardinal number (with or without thousands
  separators) into its natural spoken English word form (e.g. "400" → "four hundred"; "12,500" →
  "twelve thousand five hundred"; "1,000,000" → "one million"), never producing a digit-by-digit
  reading for such numbers.
- **FR-004**: The normalizer MUST treat a digit sequence as digit-by-digit (spoken one digit at a
  time) only when it carries an explicit code/phone signal: an immediately preceding label word
  (e.g. "PIN", "code", "ext", "extension", "ID", "#") or an internal phone-like separator pattern
  (dashes or spaces breaking the digits into groups, e.g. "801-234-5678"). A digit sequence
  without such a signal, however long, MUST be converted as a plain cardinal number instead.
- **FR-005**: The normalizer MUST convert a bare four-digit number in the range 1000-2099 into
  its natural spoken year form (e.g. "1998" → "nineteen ninety-eight"; "2024" → "twenty
  twenty-four"; "2000" → "two thousand") UNLESS that number is immediately preceded by a currency
  symbol or immediately followed by a unit/count word signaling a plain quantity — in either
  exception case it MUST be normalized as a plain cardinal or currency amount instead, not as a
  year.
- **FR-006**: The normalizer MUST convert a supported currency amount into its natural spoken
  form, including the correct singular/plural unit noun and, when cents/minor-unit digits are
  present, an "and ... cents"-style reading (e.g. "$400" → "four hundred dollars"; "$1" → "one
  dollar"; "$1.50" → "one dollar and fifty cents"; "£400" → "four hundred pounds"; "€400" → "four
  hundred euros").
- **FR-007**: The normalizer MUST recognize the magnitude suffixes k, m, mn, million, b, bn,
  billion, t, tn, trillion on a supported currency amount and speak the full magnitude word,
  including a fractional magnitude value spoken with "point" (e.g. "$4m" → "four million
  dollars"; "$2.5bn" → "two point five billion dollars").
- **FR-008**: Currency support in this spec is limited to the $, £, and € symbols; an amount
  using any other currency symbol or a 3-letter currency code is left as printed text in the
  spoken output (deferred, per Edge Cases).
- **FR-009**: The normalizer MUST convert a percentage into its natural spoken form, including a
  decimal percentage (e.g. "20%" → "twenty percent"; "0.5%" → "zero point five percent").
- **FR-010**: The normalizer MUST convert a standalone decimal number not otherwise classified as
  a currency amount, percentage, or year into its digit-by-digit "point" spoken form (e.g. "3.14"
  → "three point one four").
- **FR-011**: The normalizer MUST convert an ordinal number into its natural spoken word form
  (e.g. "1st" → "first"; "2nd" → "second"; "21st" → "twenty-first").
- **FR-012**: The normalizer's process MUST be staged as detection before conversion: it MUST
  first identify and classify each numeric/currency/percentage/year/ordinal span in the text
  (assigning it exactly one category), and only then convert each classified span to its spoken
  form — a single combined regex/replace pass that conflates classification and conversion MUST
  NOT be the mechanism.
- **FR-013**: When the normalizer cannot confidently classify a numeric-looking span into any
  supported category, it MUST leave that span's original text unmodified in the spoken output
  rather than guessing at a conversion or dropping the content.
- **FR-014**: Normalization MUST NOT change the meaning of any numeric value — the spoken form
  MUST represent the exact same quantity, currency amount, year, percentage, or ordinal as the
  original printed text.
- **FR-015**: The normalizer MUST NOT use a generative/LLM-based approach; all conversions MUST
  be deterministic (the same input text always produces the same spoken text).
- **FR-016**: The pipeline's existing citation-marker and bare-URL stripping (`stripCitationsAndUrls`)
  MUST continue to run unchanged; this spec adds numeric/currency/date/percent/ordinal
  normalization as an additional step, not a replacement.
- **FR-017**: A document containing none of the numeric/currency/percentage/year/ordinal patterns
  this spec handles MUST narrate identically to how it narrated before this spec (no incidental
  change to unrelated text).
- **FR-018**: This spec MUST NOT introduce any new block-type detection or classification logic,
  any new UI control, or any network call; it operates purely on already-classified,
  already-policy-filtered block text.

### Key Entities *(include if feature involves data)*

- **Spoken Text**: The derived, TTS-only text form of a block's narratable content, distinct from
  and never overwriting the block's original text (used for display, highlighting, search,
  navigation per the project's core design principle).
- **Normalized Entity**: One detected numeric-like span within a block's text, classified into
  exactly one category (cardinal, year, currency, percentage, decimal, ordinal, or
  code/phone-digit-sequence) before conversion. Carries the original matched text and its
  resulting spoken-word replacement.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the existing behavioral test suite (136 tests as of spec 005) continues to
  pass unmodified after this feature, with no pre-existing test needing rewriting to tolerate a
  behavior change.
- **SC-002**: For a representative document containing no numeric/currency/percentage/year/
  ordinal patterns, narration output is byte-for-byte identical to the pre-006 baseline (FR-017).
- **SC-003**: For each required example pattern in User Stories 1-3 (cardinal numbers with and
  without separators, currency with and without magnitude suffixes and cents, years including the
  documented disambiguation exceptions, percentages, standalone decimals, ordinals, and
  code/phone digit sequences), the produced spoken text exactly matches the documented natural
  spoken form.
- **SC-004**: A numeric-looking span the engine cannot confidently classify is never converted
  into an incorrect reading and is never silently dropped from the spoken text (100% of such
  spans are left as their original printed text, verified against at least one deliberately
  ambiguous/malformed test case).
- **SC-005**: Displayed text (used for on-screen rendering, highlighting, search, navigation)
  remains completely unaffected by normalization for 100% of documents processed — spoken text
  and original text are always independently retrievable and never conflated.

## Assumptions

- "Natural spoken English word form" follows US English number-naming conventions (e.g. "one
  million", "twenty-one", "and fifty cents") consistent with the examples given in the feature
  description; locale-specific number/date conventions (e.g. British vs. American date order,
  non-English number words) are out of scope for this spec and deferred to a future
  locale-configuration spec, consistent with the project's staged rollout of the full goal
  architecture.
- Full date normalization (e.g. "12/09/2026" → "the twelfth of September, twenty twenty-six") is
  out of scope for this spec — this spec covers bare 4-digit years appearing in running text, not
  slash- or dash-formatted calendar dates, which involve locale-dependent day/month/year ordering
  the project's broader architecture defers to a locale-configuration capability not yet built.
- Currency scope is intentionally limited to $, £, € for this first version (per the Currency
  Scope decision); ₦, ¥, and 3-letter currency codes (USD, GBP, EUR, NGN) are deferred to a
  follow-up increment once this narrower scope is proven correct.
- Table, caption, and other structurally-excluded block types are unaffected by this spec, since
  normalization only ever sees text the speech policy has already selected to speak.
- No user-facing settings or locale picker is introduced by this spec — normalization behavior is
  fixed for this version, matching the "no new UI controls" scope boundary established in specs
  004-005.
