# Quickstart: Sentence Highlight Alignment

## Focused validation

From `reader-app/`:

```bash
node --experimental-strip-types --test \
  src/reader/narration/highlight-geometry.test.ts \
  src/reader/narration/compiler.test.ts \
  src/reader/pdf/text-extractor.test.ts \
  src/components/reader/page-navigation.test.ts \
  src/reader/controller.test.ts
npm run typecheck
npx eslint \
  src/reader/narration/highlight-geometry.ts \
  src/reader/narration/highlight-geometry.test.ts \
  src/reader/narration/paragraph-builder.ts \
  src/reader/narration/compiler.ts \
  src/reader/narration/compiler.test.ts \
  src/reader/pdf/text-extractor.ts \
  src/reader/pdf/text-extractor.test.ts \
  src/reader/pdf/pdf-engine.ts \
  src/components/reader/pdf-viewer.tsx \
  src/components/reader/page-navigation.ts \
  src/components/reader/page-navigation.test.ts
npx prettier --check \
  src/reader/narration/highlight-geometry.ts \
  src/reader/narration/highlight-geometry.test.ts \
  src/reader/narration/paragraph-builder.ts \
  src/reader/narration/compiler.ts \
  src/reader/narration/compiler.test.ts \
  src/reader/pdf/text-extractor.ts \
  src/reader/pdf/text-extractor.test.ts \
  src/reader/pdf/pdf-engine.ts \
  src/components/reader/pdf-viewer.tsx \
  src/components/reader/page-navigation.ts \
  src/components/reader/page-navigation.test.ts
npm run build:dev
```

## Manual validation

1. Start the local app with `./start-local.sh`.
2. Open the sample PDF or a text PDF with two sentences in one paragraph.
3. Start narration.
4. Confirm that the highlight follows the active sentence, not the full paragraph.
5. Change fit width and zoom.
6. Seek, pause, resume, and scroll manually.
7. Confirm that the active highlight remains aligned and that no invalid overlay appears.
8. Select pages from the sidebar and confirm that the selected page appears at the reader viewport start.
9. Stop the launcher with `Ctrl-C` and confirm that it releases the processes it started.

## Recorded validation result

The focused reader suite passed 21 tests.

The type check, changed-file ESLint check, Prettier check, and development build passed.

The full new-app suite passed 181 tests and reported 16 unrelated baseline failures in branding, app-environment, and metadata checks.

Browser visual verification remains pending because browser automation was unavailable in the implementation session.
