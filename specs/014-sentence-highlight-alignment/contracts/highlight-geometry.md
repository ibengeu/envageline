# Contract: Highlight Geometry Mapping

## `mapSentenceBounds`

### Input

- An ordered list of sentence strings.
- An ordered list of source line strings.
- An equally ordered list of normalized source line rectangles.

### Output

An array with one rectangle array per sentence.

### Rules

1. Preserve sentence order.
2. Match source tokens in order after case and punctuation normalization.
3. Allow source tokens that were removed by citation cleanup.
4. Include every source line that contains a matched token.
5. Return an empty array when a sentence has no valid matching geometry.
6. Never return non-finite, zero-size, or out-of-range rectangles.

## Security behavior

- Treat source text as literal data.
- Bound work to the supplied source lines and tokens.
- Ignore invalid geometry instead of emitting invalid CSS values.
