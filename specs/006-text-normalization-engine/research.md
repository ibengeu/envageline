# Phase 0 Research: Text Normalization Engine

No `NEEDS CLARIFICATION` markers remain in Technical Context — the three hardest scope questions
(year disambiguation, code/phone detection, currency coverage) were already resolved with the
user before spec.md was written (see spec.md's Assumptions). Research here covers the remaining
implementation-level decisions: the number-to-words algorithm, detection ordering/regex design,
and the ReDoS mitigation the Security Review commits to.

## Decision 1: Number-to-words algorithm

**Decision**: A small, hand-written cardinal-to-words function using a fixed lookup table for
0-19, tens (twenty, thirty, ..., ninety), and scale words (hundred, thousand, million, billion,
trillion), built recursively by grouping the number into 3-digit chunks from the most significant
end (standard "short scale" English number-naming, matching every example in spec.md: "twelve
thousand five hundred", "one million").

```text
toCardinalWords(n):
  if n === 0: return "zero"
  groups = split n into 3-digit chunks (thousands, millions, billions, trillions)
  for each non-zero group, from most to least significant:
    emit threeDigitGroupToWords(group) + that group's scale word (thousand/million/...)
  join emitted parts with spaces
```

**Rationale**: This is a bounded, well-understood algorithm (the classic "number to words"
conversion) with no ambiguity for the range this pipeline needs (spec.md's examples top out at
"$2.5bn" → billions). Writing it directly keeps the conversion auditable and trivially
unit-testable per digit-group, satisfying FR-015's determinism requirement without pulling in an
external i18n library whose locale/pluralization surface would be far larger than this feature
needs (Principle V).

**Alternatives considered**:
- *`Intl.PluralRules`/`Intl.NumberFormat`*: these format numbers as digit groups or handle
  pluralization rules, not number-to-words conversion — they solve a different problem and don't
  reduce implementation work here.
- *A third-party number-to-words npm package*: rejected per the plan's Structure Decision —
  introduces a new dependency for a well-bounded, small algorithm this project can own and fully
  test deterministically; also this project vendors dependencies at pinned versions (constitution
  Technology Constraints), which is more ceremony than a ~40-line function warrants.

## Decision 2: Entity detection ordering and non-overlap

**Decision**: `detectNumericEntities(text)` runs a fixed sequence of regex scans in this priority
order, and once a span of text is claimed by an earlier category it is never re-matched by a
later one (achieved by scanning left-to-right and tracking claimed character ranges, or
equivalently by having each later pattern's match attempt skip ranges already claimed):

1. **Currency** (`$`/`£`/`€` + digits, optional thousands separators, optional decimal cents,
   optional magnitude suffix) — most specific, must claim its digits before cardinal/decimal/year
   scanning can see them (FR-006/007/008; Edge Case: "$1998" must not become a year).
2. **Percentage** (a number, optionally decimal, immediately followed by `%`) — must claim before
   plain decimal scanning (FR-009; Edge Case: "0.5%" must not become "zero point five" without
   "percent").
3. **Ordinal** (a number immediately followed by `st`/`nd`/`rd`/`th`) — must claim before cardinal
   scanning (FR-011; "21st" must not become "twenty-one" + stray "st").
4. **Code/phone digit sequence** (a label word immediately before a digit run, OR a digit run
   containing internal phone-like dash/space separators) — must claim before cardinal scanning
   (FR-004).
5. **Year** (a bare 4-digit number in 1000-2099, with the currency-symbol-before /
   unit-word-after exception check applied inline) — must claim before generic decimal/cardinal
   scanning, but only once the exceptions in FR-005 are checked (which is why currency scanning,
   step 1, must run first — it needs to have already claimed "$1998" before year scanning would
   otherwise consider "1998" a candidate).
6. **Decimal** (a number containing a `.` not already claimed by currency/percentage) — must
   claim before plain cardinal scanning (FR-010).
7. **Cardinal** (any remaining unclaimed digit run, with or without thousands separators) — the
   fallback category; whatever digits remain unclaimed after 1-6 (FR-003).

**Rationale**: This ordering is the direct, mechanical implementation of FR-012's "detection
before conversion" requirement and of every "X must not be read as Y" edge case in spec.md (e.g.
"$1998 was the price" → currency claims it first, so year-scanning never sees it as a candidate).
Encoding priority as a fixed scan order rather than a single combined regex with lookaheads keeps
each pattern individually simple and testable (Principle V) — this is the concrete design that
satisfies the plan's "linear priority-order dispatcher, not one giant branching function"
commitment.

**Alternatives considered**:
- *One mega-regex with alternation and capture groups for every category*: technically possible,
  but directly contradicts FR-012 ("a single combined regex/replace pass that conflates
  classification and conversion MUST NOT be the mechanism") and would be far harder to reason
  about or extend when a later spec adds more categories (dates, units, sections).
- *Classify every digit run first by pure numeric heuristics, then look at surrounding context
  once per match*: considered, but doing currency/percentage/ordinal detection first (via their
  distinguishing surrounding punctuation) is simpler than post-hoc reclassification, and avoids
  the year-detector ever having to "undo" a currency match.

## Decision 3: Code/phone detection signal set

**Decision**: A digit run is classified as code/phone (digit-by-digit) when either:
- it is immediately preceded (allowing one intervening space) by one of a fixed label-word list:
  `PIN`, `code`, `ext`, `extension`, `ID`, or a literal `#`; or
- it contains at least one internal separator (`-` or a space) between digit groups in a
  phone-like shape (e.g. `801-234-5678`, `+234 801 234 5678`) — distinguished from a
  thousands-separated cardinal by using `-`/space rather than `,` as the separator, since a
  cardinal's thousands separator is always `,` in this pipeline's assumed US-English convention
  (spec.md Assumptions).

**Rationale**: Directly implements the "explicit signals only" decision made with the user before
spec.md was written (FR-004) — a bare long digit run with no such signal stays a cardinal, per
Edge Cases' explicit preference for under-detecting codes over misreading a large legitimate
cardinal digit-by-digit.

**Alternatives considered**: (See spec.md's resolved clarification — the length-based heuristic
alternative was explicitly rejected by the user in favor of this explicit-signal approach.)

## Decision 4: ReDoS mitigation

**Decision**: Every regex used in `detectNumericEntities` matches with bounded, non-nested
quantifiers — digit runs are matched with a single `\d+` (or `\d{1,N}` where a category has a
natural length bound, e.g. ordinal suffixes), separators are matched as single bounded character
classes (`[,\s-]`) between digit groups rather than as a repeated group containing its own
internal alternation. No pattern nests one unbounded quantifier inside another
(`(\d+[,\s]?)+`-shaped patterns are avoided in favor of `\d[\d,]*` or equivalent single-pass
forms).

**Rationale**: Directly implements the Security Review's A08:2025 mitigation commitment. A
single, non-nested `\d+`-style pattern is linear in input length regardless of digit-run size or
repeated-separator adversarial input, which is what a catastrophic-backtracking test (planned in
tasks.md) verifies empirically as well as by construction.

**Alternatives considered**:
- *Regex complexity analysis tooling / a regex-safety linter*: unnecessary ceremony for the small,
  fixed set of patterns this feature introduces — manual construction plus one adversarial-input
  timing test (Principle V: don't build tooling for a problem this bounded) is sufficient.

## Assumptions carried into Phase 1

- Number-to-words output uses US English conventions throughout (spec.md Assumptions) — "and" is
  used only in currency's "X dollars and Y cents" pattern, not inserted into cardinal numbers
  themselves (i.e. "one hundred five", not "one hundred and five"), matching the plan's examples.
- The magnitude-suffix currency pattern (FR-007) treats a fractional magnitude value (e.g. the
  `2.5` in `$2.5bn`) via the existing decimal-to-words "point" pattern (Decision 1's cardinal
  converter plus a "point" digit-by-digit tail), not a separate algorithm.
