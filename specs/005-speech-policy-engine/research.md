# Phase 0 Research: Speech Policy Engine

No `NEEDS CLARIFICATION` markers were produced — this feature consolidates an existing decision
(narration inclusion/exclusion) into one place, using data and call sites already established by
specs 001-004. Research here pins down the shape and wiring approach.

## Decision 1: Policy field → block type mapping

**Decision**: A flat, explicit `SpeechPolicy` object with one property per concept from the goal
architecture's `SpeechPolicy` interface, mapped to this pipeline's actual block types where one
exists:

| Policy field | Type | Block type it currently governs | Default |
|---|---|---|---|
| `speakTitles` | boolean | `heading` (shared with `speakHeadings` — see Assumption in spec.md) | `true` |
| `speakHeadings` | boolean | `heading` | `true` |
| `speakPageNumbers` | boolean | `page-number` | `false` |
| `speakHeaders` | boolean | `header` | `false` |
| `speakFooters` | boolean | `footer` | `false` |
| `speakFootnotes` | boolean | `footnote` | `false` |
| `speakCaptions` | boolean | `caption` | `false` |
| `speakCitations` | boolean | none yet (inert, forward-compatible) | `false` |
| `speakReferences` | boolean | none yet (inert, forward-compatible) | `false` |
| `tables` | `"skip" \| "summary" \| "detailed"` | `table` (only `"skip"` has an effect today) | `"skip"` |

`body` blocks are always spoken — there is no policy field for them, since neither the goal
architecture's policy shape nor any current requirement treats body text as excludable. This
matches today's implicit behavior (`NARRATION_EXCLUDED_TYPES` never contains `"body"`).

**Rationale**: Directly satisfies FR-003/FR-004 and User Story 3's field-name expectations, while
keeping every field's effect traceable to a real, already-classified block type (or explicitly
inert, per spec.md's Edge Cases, for concepts with no block type yet). A flat object (not nested,
not versioned) is the simplest shape satisfying current requirements — Principle V.

**Alternatives considered**:
- *One field per type, no goal-architecture naming (`speakBody`, `speakHeading`, ... matching
  block-type strings exactly)*: simpler 1:1 mapping, but abandons User Story 3's explicit goal —
  matching the field names a future reading-mode setting will actually use. Rejected because
  spec.md's own acceptance scenario (US3, AS1) requires the goal document's field names.
- *A single `Map<blockType, boolean>` instead of named fields*: more "generic," but harder to
  read/type at call sites and doesn't naturally support `tables`' three-way mode — named fields
  are simpler to reason about for the fixed, small set of block types this pipeline has.

## Decision 2: Single source-of-truth function

**Decision**: One function, `shouldSpeak(type, policy)`, is the only place that maps a block type
to an inclusion/exclusion boolean. Both `toAstBlock` (for the `speak` field) and
`renderNarrationText` (for its filter) call it with the same resolved policy object.

```text
shouldSpeak(type, policy):
  heading      -> policy.speakHeadings (speakTitles reserved for a future distinct title type)
  header       -> policy.speakHeaders
  footer       -> policy.speakFooters
  page-number  -> policy.speakPageNumbers
  footnote     -> policy.speakFootnotes
  caption      -> policy.speakCaptions
  table        -> policy.tables !== "skip"
  body         -> true
  (anything else) -> true   # matches today's implicit fallback: NARRATION_EXCLUDED_TYPES.has(x)
                              # is false for any type not in the set, so unknown types are spoken
```

**Rationale**: This is the actual fix FR-005/User Story 2 require — today, the same decision is
independently hardcoded in two places (`app.js:581` and `app.js:651`), which is exactly the drift
risk a future contributor could hit by updating one and not the other. One function called from
both sites makes that structurally impossible rather than relying on developer discipline.

**Alternatives considered**:
- *Policy object exposes a `shouldSpeak(type)` method instead of a free function taking policy as
  an argument*: rejected per Constitution Principle III's ban on testing concrete types/methods —
  a plain data object with a separate pure function is simpler to test (assert on `shouldSpeak`'s
  return value directly) and keeps `SpeechPolicy` a plain, serializable data shape (relevant for
  a future settings-persistence spec, even though persistence itself is out of scope here).

## Decision 3: Default + override resolution

**Decision**: `resolveSpeechPolicy(overrides)` merges a caller-supplied partial object over
`DEFAULT_SPEECH_POLICY` field-by-field (shallow merge — the policy has no nested objects), so any
field the caller omits falls back to the default (FR-006). `buildPipelineOutput`,
`buildDocumentAst`, and `renderNarrationText` each accept an optional `policy` parameter;
omitting it resolves to `DEFAULT_SPEECH_POLICY` via the same function, so there is exactly one
default-application path, not one per function.

**Rationale**: A shallow merge is sufficient and simplest given Decision 1's flat shape (no nested
objects to deep-merge) — satisfies FR-006 without introducing a merge library or recursive logic
Principle V would flag as unwarranted complexity for this data shape.

**Alternatives considered**:
- *Require callers to always pass a complete policy object (no partial-override merging)*:
  simpler function signature, but directly contradicts FR-006 ("MUST accept a caller-supplied
  policy that overrides only some fields") and User Story 2's acceptance scenario of changing one
  field without restating the rest.

## Decision 4: Removing `NARRATION_EXCLUDED_TYPES`

**Decision**: Once both call sites (`toAstBlock`, `renderNarrationText`) are migrated to
`shouldSpeak`, delete the `NARRATION_EXCLUDED_TYPES` constant entirely rather than leaving it
unused alongside the new policy.

**Rationale**: An unused constant that used to be the source of truth is exactly the kind of
leftover that causes future confusion ("which one is authoritative now?"). Principle V favors
deleting fully-superseded code over leaving it as dead weight. This is safe because no other
function in the codebase references it (verified: it was consumed at exactly the two lines this
spec migrates).

**Alternatives considered**:
- *Keep `NARRATION_EXCLUDED_TYPES` as a comment or derive `DEFAULT_SPEECH_POLICY` from it
  programmatically*: rejected — the constant's job is fully replaced by the default policy's
  field values (Decision 1's table); keeping it around (even as a derivation source) reintroduces
  a second place that encodes the same information, the opposite of this spec's goal.

## Assumptions carried into Phase 1

- `speakTitles` has no independent effect in this spec (Decision 1) since no distinct `title`
  block type exists yet — this mirrors spec 004's research.md precedent of including a
  forward-compatible schema field without fabricating behavior it can't yet honestly support.
- The `tables` field's `"summary"` and `"detailed"` modes are accepted and stored but behave
  identically to `"skip"`'s opposite (i.e., anything other than `"skip"` currently means "speak the
  table's raw text," since this pipeline has no table-summarization logic) — per spec.md's Edge
  Cases, this is a documented, non-erroring gap, not a defect.
