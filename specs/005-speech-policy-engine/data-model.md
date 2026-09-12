# Phase 1 Data Model: Speech Policy Engine

## SpeechPolicy

A plain configuration object (spec.md §"SpeechPolicy"). Research.md Decision 1 fixes its exact
fields and defaults.

| Field | Type | Default | Governs |
|---|---|---|---|
| `speakTitles` | `boolean` | `true` | Inert in this spec (research.md Assumption) — reserved for a future distinct `title` block type. |
| `speakHeadings` | `boolean` | `true` | `heading`-typed blocks. |
| `speakPageNumbers` | `boolean` | `false` | `page-number`-typed blocks. |
| `speakHeaders` | `boolean` | `false` | `header`-typed blocks. |
| `speakFooters` | `boolean` | `false` | `footer`-typed blocks. |
| `speakFootnotes` | `boolean` | `false` | `footnote`-typed blocks. |
| `speakCaptions` | `boolean` | `false` | `caption`-typed blocks. |
| `speakCitations` | `boolean` | `false` | Inert in this spec — no `citation` block type exists yet. |
| `speakReferences` | `boolean` | `false` | Inert in this spec — no `reference` block type exists yet. |
| `tables` | `"skip" \| "summary" \| "detailed"` | `"skip"` | `table`-typed blocks; only the skip/non-skip distinction has an effect today. |

All fields are required to have *some* value on any policy actually used by `shouldSpeak` — but
callers may omit any subset when constructing an override, per `resolveSpeechPolicy`'s merge
(FR-006).

## DEFAULT_SPEECH_POLICY

The specific `SpeechPolicy` value (module-level constant) whose fields are exactly the "Default"
column above. This is the policy used whenever no override is supplied, and it is the merge base
for every partial override. Its values are fixed by FR-001/FR-002 to make `shouldSpeak`'s result
for every current block type identical to `NARRATION_EXCLUDED_TYPES.has(type)`'s old result:

| Block type | Old: `NARRATION_EXCLUDED_TYPES.has(type)` (excluded?) | New: `shouldSpeak(type, DEFAULT_SPEECH_POLICY)` |
|---|---|---|
| `body` | `false` (spoken) | `true` (spoken) |
| `heading` | `false` (spoken) | `true` (spoken, via `speakHeadings`) |
| `header` | `true` (excluded) | `false` (via `speakHeaders`) |
| `footer` | `true` (excluded) | `false` (via `speakFooters`) |
| `page-number` | `true` (excluded) | `false` (via `speakPageNumbers`) |
| `footnote` | `true` (excluded) | `false` (via `speakFootnotes`) |
| `caption` | `true` (excluded) | `false` (via `speakCaptions`) |
| `table` | `true` (excluded) | `false` (via `tables: "skip"`) |

## Validation rules (from Functional Requirements)

- `shouldSpeak(type, DEFAULT_SPEECH_POLICY)` MUST equal `!NARRATION_EXCLUDED_TYPES.has(type)`'s
  old result for every type in the table above (FR-001, FR-002) — this table *is* that
  requirement, made explicit.
- `resolveSpeechPolicy(overrides)` MUST return a value equal to `DEFAULT_SPEECH_POLICY` in every
  field `overrides` does not set, and equal to `overrides`'s value in every field it does set
  (FR-006).
- For any policy and any block type, changing exactly one relevant policy field MUST change
  `shouldSpeak`'s result for that type and no other type (FR-009) — e.g. flipping
  `speakFootnotes` must not change the result for `caption` or any other type.
- `toAstBlock`'s `speak` field and `renderNarrationText`'s inclusion decision for a given block
  and a given resolved policy MUST always agree (FR-005) — both call the same `shouldSpeak`.

## State transitions

None — `SpeechPolicy` values are immutable, freshly-resolved plain objects per
`buildPipelineOutput` call, consistent with the pipeline's existing stateless, per-load processing
model (same as spec 004's Document/Section/Block entities).
