# Research: Sentence Highlight Alignment

## Decision 1: Map each sentence to source-line geometry

The current compiler assigns `ParagraphGroup.bounds` to every sentence. That creates a paragraph-wide overlay. The fix will preserve the paragraph's source line text and line rectangles, then map each sentence to the smallest ordered set of matching source lines.

The mapping will compare normalized word tokens. It will tolerate removed citation tokens and cleaned punctuation. If no token matches, the mapper will return no rectangle for that sentence. This keeps the overlay safe without changing spoken text.

## Decision 2: Keep the existing normalized rectangle contract

`NarrationSegment.bounds` already stores normalized `{ x, y, width, height }` rectangles. The implementation will keep this public shape. The compiler and PDF extractor will produce finite values between 0 and 1.

## Decision 3: Transform PDF text rectangles through the page viewport

The renderer uses the PDF.js page viewport. Text extraction must use the same viewport transform. The extractor will transform the four corners of each text item rectangle, calculate the axis-aligned viewport rectangle, and normalize it by the viewport width and height. This supports page rotation and display scaling without a separate rotation branch.

## Decision 4: Validate geometry before rendering

The geometry helper and overlay will reject non-finite, zero-size, and out-of-range rectangles. The helper will clamp small floating-point overflow to the normalized range. React will receive only safe CSS percentage values.

## Decision 5: Preserve existing reading behavior

Sentence splitting, reading order, speech text, click-to-seek, scrolling, and storage remain unchanged. The change only narrows `bounds` and aligns extracted rectangles with the rendered viewport.

## Rejected alternatives

- **Use the full paragraph rectangle**: Rejected because it causes the reported defect.
- **Use one bounding rectangle for the sentence**: Rejected because a multi-line sentence would cover unrelated text between lines.
- **Recalculate geometry in the React overlay**: Rejected because the extractor already owns PDF coordinates and the overlay should use the same normalized contract at every viewport size.
- **Add a PDF.js or geometry dependency**: Rejected because the existing matrix and browser APIs are sufficient.
