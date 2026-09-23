# Contract: PDF Viewport Geometry

## `itemsToBlocks`

### Input

- PDF text items.
- Page number.
- PDF.js viewport width and height.
- PDF.js viewport transform.

### Output

Document blocks with normalized top-left rectangles.

### Rules

1. Transform all four corners of each text item rectangle through the supplied viewport transform.
2. Calculate the axis-aligned rectangle in viewport coordinates.
3. Normalize by viewport width and height.
4. Clamp small floating-point overflow to the normalized range.
5. Ignore items with no text or invalid geometry.
6. Preserve page number and literal text.

## Security behavior

- Do not interpret extracted text as markup.
- Do not allocate output based on unbounded values from a single item.
- Return safe empty geometry for zero or invalid page dimensions.
