# Implementation Plan: Sentence Highlight Alignment

## Summary

Fix the new reader highlight geometry. Each narration segment will receive only the source line rectangles that contain its sentence. PDF text rectangles will use the same viewport transform as the rendered page. The overlay will reject invalid rectangles before it writes CSS values.

## Technical Context

- **Language**: TypeScript 5.7 with React 19.
- **Runtime**: Browser APIs with Node.js 22 test execution.
- **Rendering**: PDF.js page viewport and canvas rendering.
- **Existing contract**: `NarrationSegment.bounds` contains normalized rectangles with values from 0 to 1.
- **Current defect**: `compilePage` assigns the complete paragraph bounds to every sentence.
- **Current transform risk**: `itemsToBlocks` calculates rectangles from raw PDF text transforms and does not apply the page viewport transform for rotated pages.
- **Dependencies**: No new dependency.
- **Storage**: No schema or persistence change.
- **Network**: No new request.
- **Performance goal**: Geometry mapping remains linear in source lines and sentence tokens for one page.
- **Complexity goal**: Keep every changed function at cyclomatic complexity 10 or less.

## Constitution Check

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Local-First Privacy | PASS | The change processes geometry locally and adds no network path. |
| II. Narrow Product Surface | PASS | The change improves document listening alignment. |
| III. Behavior-Driven TDD | PASS | The plan uses public compiler, extractor, and rendering outcomes in small red-green-refactor cycles. |
| IV. Security Review as a Gate | PASS | The Security Review below maps applicable OWASP categories and tests. |
| V. Simplicity & Cyclomatic Discipline | PASS | The design uses one pure mapping helper, one viewport conversion helper, and existing normalized rectangles. |

## Security Review

### Applicable OWASP Top 10:2025 categories

- **A02:2025 Security Misconfiguration**: Invalid document geometry must not create invalid CSS values or fail open into unsafe rendering. Page navigation must accept only validated page numbers before DOM selection. Mitigate with finite-value checks, clamping, safe omission, and positive-integer page validation. Test malformed dimensions, rectangles, and page values at public boundaries.
- **A04:2025 Insecure Design**: User PDF content is untrusted and can contain unusual text item counts, dimensions, and transforms. Mitigate with bounded per-item geometry work, finite-value guards, and no unbounded DOM creation from invalid boxes. Test empty, zero-size, and extreme geometry.
- **A07:2025 Injection**: Extracted PDF text remains data during sentence-to-line mapping and rendering. Mitigate by keeping text in typed values and using React text-safe rendering. Test punctuation, citation removal, and hostile literal text without HTML interpretation.

### Not applicable categories

- **A01:2025 Broken Access Control** is not applicable. The feature has no identity, role, ownership, tenant, or protected resource boundary.
- **A03:2025 Software Supply Chain Failures** is not applicable. The feature adds no package, runtime dependency, or external artifact.
- **A05:2025 Cryptographic Failures** is not applicable. The feature adds no secret, credential, encryption, hash, or sensitive-data storage.
- **A06:2025 Identification and Authentication Failures** is not applicable. The feature has no authentication, session, token, or recovery flow.
- **A08:2025 Security Logging and Monitoring Failures** is not applicable. The feature adds no security event or audit log. Existing safe error handling remains unchanged.
- **A09:2025 Server-Side Request Forgery** is not applicable. The feature adds no outbound request and does not change the existing local TTS request path.
- **A10:2025 Vulnerable and Outdated Components** is not applicable to the implementation. The feature adds no component. Existing dependency checks remain part of validation.

### NIST SSDF alignment

- **PO.1**: Trace the fix to the feature specification, plan, tasks, contracts, and tests.
- **PO.3**: Define the trust boundary at untrusted PDF text and geometry entering browser rendering.
- **PW.1**: Use public behavior tests for sentence geometry, viewport conversion, and safe invalid input handling.
- **PW.2**: Use finite-value validation, clamping, and literal text handling as secure defaults.
- **PW.5**: Add no dependency and preserve existing runtime behavior outside the overlay path.
- **PW.7**: Review changed code for resource exhaustion, invalid CSS, text injection, and stale geometry.
- **RV.1**: Run focused tests, type checking, linting, formatting, and the new-app build.

## Project Structure

### New files

- `reader-app/src/reader/narration/highlight-geometry.ts`: Pure sentence-to-source-line mapping and geometry validation.
- `reader-app/src/reader/narration/highlight-geometry.test.ts`: Public behavior tests for sentence geometry mapping.
- `specs/014-sentence-highlight-alignment/research.md`: Design decisions and resolved unknowns.
- `specs/014-sentence-highlight-alignment/data-model.md`: Geometry model and invariants.
- `specs/014-sentence-highlight-alignment/contracts/highlight-geometry.md`: Pure mapping contract.
- `specs/014-sentence-highlight-alignment/contracts/pdf-viewport-geometry.md`: PDF viewport conversion contract.
- `specs/014-sentence-highlight-alignment/quickstart.md`: Focused validation and manual verification.

### Modified files

- `reader-app/src/reader/narration/paragraph-builder.ts`: Preserve source line text and line geometry for mapping.
- `reader-app/src/reader/narration/compiler.ts`: Assign sentence-specific bounds.
- `reader-app/src/reader/narration/compiler.test.ts`: Add sentence-boundary behavior tests.
- `reader-app/src/reader/pdf/text-extractor.ts`: Apply the rendered page viewport transform to text item rectangles.
- `reader-app/src/reader/pdf/pdf-engine.ts`: Pass the page viewport transform into text extraction.
- `reader-app/src/reader/pdf/text-extractor.test.ts`: Add identity and rotated viewport geometry tests.
- `reader-app/src/components/reader/pdf-viewer.tsx`: Filter invalid rectangles and keep valid overlay rectangles above the canvas.
- `reader-app/src/components/reader/page-navigation.ts`: Scroll a selected page within the reader scroller.
- `reader-app/src/components/reader/page-navigation.test.ts`: Verify selected-page scroll behavior.
- `reader-app/src/styles.css`: Add only the minimum overlay stacking rule if needed.

The old `pdf-reader` implementation remains out of scope.

## TDD Plan

Use one micro-cycle per observable behavior.

### Cycle 1: Sentence geometry mapping

1. Review existing compiler and paragraph-builder tests.
2. Write one failing test for two sentences with separate source lines.
3. Implement the minimum source-line mapping helper.
4. Run the focused test and confirm that it passes.
5. Refactor only after the test passes.

### Cycle 2: Multi-line and cleanup mapping

1. Write one failing test for a sentence that crosses a line break.
2. Add the minimum mapping behavior.
3. Run the mapping and compiler tests.
4. Refactor without changing the public result.

### Cycle 3: PDF viewport geometry

1. Review the existing text extraction tests and rendering contract.
2. Write one failing test for a rotated viewport transform.
3. Implement corner transformation and normalized bounds.
4. Run identity and rotated geometry tests.
5. Refactor and confirm no invalid rectangle values remain.

### Cycle 4: Overlay safety

1. Write one failing test for invalid and zero-size rectangles at the public geometry boundary.
2. Implement finite-value validation and omission.
3. Run the geometry and compiler tests.
4. Refactor if needed.

### Cycle 5: Regression validation

1. Update existing public behavior tests where the expected bounds contract changes.
2. Run the focused narration, extractor, and controller tests.
3. Run type checking, ESLint, Prettier, and the new-app build.
4. Perform the manual overlay walkthrough when a browser and sample PDF are available.

## Design Decisions

1. **Use source-line rectangles first**: The existing PDF text items already provide visible geometry. Line-level rectangles avoid paragraph-wide highlights and support sentences that span lines.
2. **Keep sentence text and geometry separate**: Mapping uses source text only to select geometry. The existing spoken-text normalization remains unchanged.
3. **Transform rectangle corners**: Convert each text item rectangle through the page viewport matrix. This keeps extraction and canvas rendering in one coordinate system for rotation and scale.
4. **Fail safe on invalid geometry**: Ignore non-finite or non-positive rectangles. Do not emit invalid CSS values.
5. **No new persistence**: Bounds remain part of in-memory and existing segment records. The current segment storage version does not change because the segment shape remains the same.
6. **No paragraph merge change**: Sentence splitting and reading order remain unchanged.
7. **Use one page navigation boundary**: Sidebar and header page changes use the same validated page selection state. The viewer scrolls inside its own scroller and retries after virtualized page rendering.

## Validation

- Focused tests:
  - `node --experimental-strip-types --test src/components/reader/page-navigation.test.ts src/reader/narration/highlight-geometry.test.ts src/reader/narration/compiler.test.ts src/reader/pdf/text-extractor.test.ts src/reader/controller.test.ts`
- Type checking: `npm run typecheck`
- Lint: `npx eslint` on changed files.
- Formatting: `npx prettier --check` on changed files.
- Build: `npm run build:dev`
- Security checks: invalid geometry, literal hostile text, and no new network or dependency changes.
- Manual check: sample PDF at fit width, zoom, sentence transitions, click-to-seek, and rotated test page.

## Completion Criteria

- Each sentence receives only its source line rectangles.
- Multi-line sentences receive all relevant source line rectangles.
- Rotated and scaled pages keep overlay and canvas aligned.
- Invalid rectangles do not create invalid CSS or narration failures.
- Existing reader interaction remains unchanged.
- Focused tests, type checking, lint, formatting, and build pass.
- The old reader remains unchanged.
