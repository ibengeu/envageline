---
target: /
total_score: 21
p0_count: 0
p1_count: 2
timestamp: 2026-07-13T21-58-33Z
slug: pdf-reader-index-html
---
Method: dual-agent (A: /root/design_review · B: /root/evidence_review)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2 | Playback state is communicated, but disabled Play has no explanation and progress gives no document position. |
| 2 | Match System / Real World | 3 | File, page, word, and transport language is familiar; “Local Kokoro” and a raw endpoint are not. |
| 3 | User Control and Freedom | 2 | Stop restarts rather than preserving a recoverable position; passage jumping is hidden. |
| 4 | Consistency and Standards | 3 | Controls share a coherent vocabulary and retain native semantics. |
| 5 | Error Prevention | 2 | Local-only endpoint validation is sound, but Local mode lacks a readiness check before a user encounters failure. |
| 6 | Recognition Rather Than Recall | 2 | Rate/pitch values are visible, but selecting text to start playback and scanned-PDF limits are not explained. |
| 7 | Flexibility and Efficiency | 2 | Drag-and-drop and chunk jumping help, but voices are an unfiltered OS-sized list with no search or presets. |
| 8 | Aesthetic and Minimalist Design | 2 | The file flow is clear, but the decorative shell, glow, grid and oversized heading compete with a focused reader. |
| 9 | Error Recovery | 2 | Safe status copy exists, yet image-only PDFs, unavailable voices, local-server failure, and parse failure lack recovery guidance. |
| 10 | Help and Documentation | 1 | The important operational help lives in the README rather than the interface. |
| **Total** | | **21/40** | **Functional foundation; task-first refinement needed** |

## Anti-Patterns Verdict

**LLM assessment:** This is credible and polished, but it looks moderately-to-highly like a generated “premium dark tool”: radial glow, decorative micro-grid, nested 2rem rounded shells, a display-scale heading, and a 1px outline paired with a 34px/90px shadow. That theatrical treatment competes with quiet long-form reading.

**Deterministic scan:** `detect.mjs --json pdf-reader/index.html` returned zero findings. It did not flag the visual issues above; the detector covers a limited set of static patterns, so the manual review caught the more consequential composition and responsive defects. No false positives.

**Visual overlays:** No reliable user-visible overlay is available. The evidence review could not acquire a browser and live injection was blocked by missing `.impeccable/live/config.json`; it verified source remained unchanged. The independent design review did inspect the live local surface at a narrow responsive viewport.

## Overall Impression

The primary upload action and local-first promise make the app immediately trustworthy. The biggest opportunity is to turn it from a visually impressive control panel into a calm reading workflow: upload first, read/listen second, tune audio only when needed.

## What's Working

- The local-first message appears before document content and fits a sensitive-PDF use case.
- File name, page count, word count, and live status make ingestion observable without exposing document content.
- Browser and local voice modes acknowledge real use cases, and literal text rendering establishes a strong security and trust baseline.

## Priority Issues

### [P1] The Reading Pane is unreachable on narrow screens

**Why it matters:** At an effective 500×900 viewport, `body` and `.app-shell` prevent page scrolling. The controls occupy about 857px, leaving the reader with roughly 11px and a 0px reader core. This removes the document from the mobile workflow.

**Fix:** Permit document-page scrolling or use an explicit controls/reader mode switch. Ensure the reader has a non-zero, reachable height at 320–560px with a loaded document.

**Suggested command:** `$impeccable adapt`

### [P1] Pre-document settings drown the happy path

**Why it matters:** A first-time user sees provider, voice, rate, pitch, stats, and transport before completing the one required action. “Local Kokoro” and a raw endpoint force infrastructure decisions before the app has delivered value.

**Fix:** Start with upload, privacy, and a concise text-based-PDF note. Reveal audio tuning after successful extraction; put Local Kokoro behind an advanced/local disclosure.

**Suggested command:** `$impeccable distill`

### [P2] Start-from-passage navigation is undiscoverable and inaccessible

**Why it matters:** Text chunks are clickable but look like ordinary text until hover. They do not offer button semantics, keyboard operation, focus styling, or an instruction. A core resume behavior is effectively pointer-only.

**Fix:** State “Select a passage to start there,” expose an accessible keyboard-operable control or a dedicated seek list, and announce active position.

**Suggested command:** `$impeccable harden`

### [P2] The decorative visual system steals attention from reading

**Why it matters:** The glow, pattern, oversized title, high-radius double shell, and broad shadows create a dashboard aesthetic instead of reducing visual fatigue during reading.

**Fix:** Use two restrained functional surfaces; remove the decorative grid and ambient glow; cap surfaces at 12–16px radii; use a product-scale heading; reserve the accent for focus and active playback.

**Suggested command:** `$impeccable quieter`

### [P2] Voice choice and recovery need guidance

**Why it matters:** Browser voices may exceed 150 items with no filter, grouping, or recommended choice. Local mode does not visibly establish readiness, and failures do not provide a next action.

**Fix:** Filter/group voices by language, offer a recommended voice or search, show “Local server connected/unavailable,” and give actionable paths for scanned PDFs, unavailable voices, and parsing errors.

**Suggested command:** `$impeccable onboard`

## Persona Red Flags

**Jordan (first-timer):** Must process provider and voice options before opening a PDF; “Local Kokoro” carries no plain-language setup expectation. “No readable text found” does not explain that a scanned PDF needs OCR.

**Alex (power user):** Has no visible shortcuts, voice search/favorites, or durable reading-position control. The unfiltered native voice list creates unnecessary scanning.

**Maya (keyboard/screen-reader user):** Passage jumping is pointer-oriented spans without focus affordance or keyboard operation. On mobile, the collapsed reading pane removes the essential content from the reachable interface.

## Minor Observations

- A horizontal scrollbar appears in narrow rendering.
- The three-line h1 takes too much vertical room before any document is present.
- Disabled transport controls still consume initial-screen space.
- Monospace text suits raw extraction inspection but is tiring as the only long-form reading treatment.
- Page count is shown without page/source boundaries in the extracted text.

## Security Review

- **A01 Access control / A06 authentication:** N/A for this local, account-free interface.
- **A07 Injection:** Relevant and well mitigated: untrusted PDF content renders through `textContent`. Preserve behavior-driven coverage for literal rendering.
- **A09 SSRF:** Relevant and well mitigated by localhost endpoint validation plus CSP. The local-mode readiness state should not weaken that allow-list.
- **A08 Logging:** No user-visible security logging requirement surfaced by this critique; do not expose document text, endpoints, or secrets in diagnostics.
- **TDD for follow-up changes:** Add one behavior test at a time: reachable mobile reading surface; keyboard-operable passage seek; Local-mode unavailable state with a safe fallback. Then implement minimally and refactor without changing behavioral assertions.

## Questions to Consider

- Is this primarily a document inspector with optional audio, or an audio reader with a lightweight transcript?
- What is the calmest first-minute flow for someone who has never configured a voice engine?
- Could browser voices be the useful default that stays invisible until a user wants to tune it?
- If someone returns to a 70-page PDF tomorrow, what should “where am I?” look like beyond an ephemeral chunk count?
