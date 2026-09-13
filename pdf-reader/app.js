(function attachReader(globalScope) {
  "use strict";

  function normalizePdfText(text) {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/([A-Za-z])-\n([A-Za-z])/g, "$1$2")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .split(/\n\n/)
      .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");
  }

  // OWASP A08:2025 Mishandling of Exceptional Conditions - an item without geometry (a
  // malformed PDF, or a caller that only has text) must not throw; it degrades to a
  // zero-size box rather than blocking extraction, consistent with FR-010/FR-012's
  // preserve-over-fail principle.
  function extractPositionedItems(items, page, pageWidth, pageHeight) {
    const width = pageWidth || 1;
    const height = pageHeight || 1;

    return items.map((item) => {
      const transform = Array.isArray(item.transform) && item.transform.length >= 6
        ? item.transform
        : [1, 0, 0, 1, 0, 0];
      const scaleX = Math.hypot(transform[0], transform[1]);
      const scaleY = Math.hypot(transform[2], transform[3]);
      const x = transform[4];
      const yTop = transform[5];
      const itemWidth = typeof item.width === "number" ? item.width : 0;
      const itemHeight = typeof item.height === "number" ? item.height : 0;
      const x0 = x / width;
      const x1 = (x + itemWidth) / width;
      const y0 = 1 - (yTop + itemHeight) / height;
      const y1 = 1 - yTop / height;

      return {
        text: item.str,
        page,
        bbox: { x0, y0, x1, y1 },
        fontSize: scaleY || scaleX || undefined,
        fontName: item.fontName || undefined,
      };
    });
  }

  function itemCenterY(item) {
    return (item.bbox.y0 + item.bbox.y1) / 2;
  }

  function medianLineHeight(items) {
    const heights = items.map((item) => item.bbox.y1 - item.bbox.y0).sort((a, b) => a - b);
    if (!heights.length) return 0;
    const mid = Math.floor(heights.length / 2);
    return heights.length % 2 ? heights[mid] : (heights[mid - 1] + heights[mid]) / 2;
  }

  function reconstructLines(items) {
    if (!items.length) return [];

    const threshold = 0.35 * medianLineHeight(items);
    const sorted = [...items].sort((a, b) => itemCenterY(a) - itemCenterY(b) || a.bbox.x0 - b.bbox.x0);
    const lines = [];
    let currentGroup = [sorted[0]];
    let currentCenterY = itemCenterY(sorted[0]);

    for (let index = 1; index < sorted.length; index += 1) {
      const item = sorted[index];
      const centerY = itemCenterY(item);
      if (Math.abs(centerY - currentCenterY) < threshold) {
        currentGroup.push(item);
      } else {
        lines.push(buildLine(currentGroup));
        currentGroup = [item];
      }
      currentCenterY = centerY;
    }
    lines.push(buildLine(currentGroup));

    return lines;
  }

  function buildLine(groupItems) {
    const ordered = [...groupItems].sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const x0 = Math.min(...ordered.map((item) => item.bbox.x0));
    const y0 = Math.min(...ordered.map((item) => item.bbox.y0));
    const x1 = Math.max(...ordered.map((item) => item.bbox.x1));
    const y1 = Math.max(...ordered.map((item) => item.bbox.y1));

    return {
      page: ordered[0].page,
      text: ordered.map((item) => item.text).join(" "),
      bbox: { x0, y0, x1, y1 },
      fontSize: ordered[0].fontSize,
      fontName: ordered[0].fontName,
      items: ordered,
    };
  }

  function linesBelongToSameBlock(previous, next) {
    const leftAligned = Math.abs(previous.bbox.x0 - next.bbox.x0) < 0.02;
    const sameFontSize = !previous.fontSize || !next.fontSize || Math.abs(previous.fontSize - next.fontSize) < 0.5;
    const lineHeight = previous.bbox.y1 - previous.bbox.y0 || 0.01;
    const gap = next.bbox.y0 - previous.bbox.y1;
    const consistentSpacing = gap < lineHeight * 1.5;

    return leftAligned && sameFontSize && consistentSpacing;
  }

  function buildBlock(groupLines) {
    const x0 = Math.min(...groupLines.map((line) => line.bbox.x0));
    const y0 = Math.min(...groupLines.map((line) => line.bbox.y0));
    const x1 = Math.max(...groupLines.map((line) => line.bbox.x1));
    const y1 = Math.max(...groupLines.map((line) => line.bbox.y1));

    return {
      page: groupLines[0].page,
      lines: groupLines,
      text: groupLines.map((line) => line.text).join(" "),
      bbox: { x0, y0, x1, y1 },
      fontSize: groupLines[0].fontSize,
      type: "body",
      confidence: 0,
      column: undefined,
    };
  }

  // Synchronous, non-cryptographic string hash (FNV-1a). Block ids are structural identifiers,
  // not the security-relevant content keys Principle IV governs (e.g. bookmark keys, which use
  // SHA-256 via crypto.subtle) — they only need to be stable and collision-resistant enough to
  // distinguish blocks within one document, and must be computable synchronously since block
  // construction elsewhere in this pipeline is synchronous (research.md Decision 1).
  function fnv1aHash(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function assignBlockIds(blocksByPage) {
    return blocksByPage.map((blocks) =>
      blocks.map((block) => {
        const bboxKey = block.bbox
          ? `${block.bbox.x0}:${block.bbox.y0}:${block.bbox.x1}:${block.bbox.y1}`
          : "";
        const id = fnv1aHash(`${block.page}::${block.text}::${bboxKey}`);
        return { ...block, id };
      }),
    );
  }

  function reconstructBlocks(lines) {
    if (!lines.length) return [];

    const blocks = [];
    let currentGroup = [lines[0]];

    for (let index = 1; index < lines.length; index += 1) {
      const previous = lines[index - 1];
      const next = lines[index];
      if (previous.page === next.page && linesBelongToSameBlock(previous, next)) {
        currentGroup.push(next);
      } else {
        blocks.push(buildBlock(currentGroup));
        currentGroup = [next];
      }
    }
    blocks.push(buildBlock(currentGroup));

    return blocks;
  }

  // A line's indentation/gap only counts as a paragraph-boundary signal when it departs from
  // the block's OWN established pattern (research.md §3) — a uniform hanging indent or uniform
  // wide spacing throughout a block is not a signal, per FR-007. Requires the departure to
  // exceed both a fixed floor (avoids false positives from sub-pixel geometry noise) and a
  // multiple of the block's own baseline (avoids false positives on a block whose "typical" gap
  // is itself already large).
  const PARAGRAPH_INDENT_MARGIN = 0.01;
  const PARAGRAPH_GAP_MULTIPLIER = 1.6;

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function lineStartsNewParagraph(line, previousLine, baselineMargin, baselineGap) {
    const indentedBeyondMargin = line.bbox.x0 - baselineMargin > PARAGRAPH_INDENT_MARGIN;
    const gap = line.bbox.y0 - previousLine.bbox.y1;
    const gapExceedsTypical = baselineGap > 0 && gap > baselineGap * PARAGRAPH_GAP_MULTIPLIER;
    return indentedBeyondMargin || gapExceedsTypical;
  }

  function splitBlockAtParagraphBoundaries(block) {
    const lines = block.lines;
    if (!lines || lines.length < 3) return [block];

    const baselineMargin = Math.min(...lines.map((line) => line.bbox.x0));
    const gaps = [];
    for (let index = 1; index < lines.length; index += 1) {
      gaps.push(lines[index].bbox.y0 - lines[index - 1].bbox.y1);
    }
    const baselineGap = median(gaps);

    const groups = [[lines[0]]];
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index];
      const previousLine = lines[index - 1];
      if (lineStartsNewParagraph(line, previousLine, baselineMargin, baselineGap)) {
        groups.push([line]);
      } else {
        groups[groups.length - 1].push(line);
      }
    }

    if (groups.length === 1) return [block];
    return groups.map((groupLines) => buildBlock(groupLines));
  }

  function splitParagraphBoundaries(blocks) {
    return blocks.flatMap((block) => splitBlockAtParagraphBoundaries(block));
  }

  function normalizeCandidateText(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\d+/g, "#")
      .replace(/\s+/g, " ")
      .trim();
  }

  function horizontalRegion(bbox) {
    const centerX = (bbox.x0 + bbox.x1) / 2;
    if (centerX < 0.4) return "left";
    if (centerX > 0.6) return "right";
    return "center";
  }

  const HEADER_ZONE = 0.12;
  const FOOTER_ZONE = 0.88;

  // A candidate must be CONFINED to the header/footer zone, not merely touch its edge — a
  // tall block that starts near the top but extends far down the page (e.g. a whole page of
  // text misgrouped into one block) is not a header/footer just because bbox.y0 is small.
  function isConfinedToHeaderZone(bbox) {
    return bbox.y0 <= HEADER_ZONE && bbox.y1 <= HEADER_ZONE * 1.5;
  }

  function isConfinedToFooterZone(bbox) {
    return bbox.y1 >= FOOTER_ZONE && bbox.y0 >= FOOTER_ZONE - (1 - FOOTER_ZONE) * 0.5;
  }

  function collectEdgeCandidates(blocksByPage, zoneTest) {
    const candidatesByKey = new Map();

    blocksByPage.forEach((blocks, pageIndex) => {
      blocks
        .filter((block) => zoneTest(block.bbox))
        .forEach((block) => {
          const normalizedText = normalizeCandidateText(block.text);
          if (!normalizedText) return;
          const region = horizontalRegion(block.bbox);
          const key = `${normalizedText}::${region}`;

          if (!candidatesByKey.has(key)) {
            candidatesByKey.set(key, { normalizedText, region, pages: [] });
          }
          candidatesByKey.get(key).pages.push(pageIndex);
        });
    });

    return [...candidatesByKey.values()].filter((candidate) => candidate.pages.length >= 2);
  }

  // Margins above/below the document's own median body font size before a size difference
  // counts as heading/footnote evidence (research.md §2) — a document-relative comparison,
  // never a fixed absolute point size, per FR-001/FR-008.
  const HEADING_FONT_SIZE_MARGIN = 1.5;
  const FOOTNOTE_FONT_SIZE_MARGIN = 1.5;

  function relativeFontSizeThreshold(bodyFontSizes, medianBodyFontSize, margin, direction) {
    if (!medianBodyFontSize || bodyFontSizes.length < 3) return undefined;
    const threshold = medianBodyFontSize + direction * margin;
    const hasContrastingSize = bodyFontSizes.some((size) =>
      direction > 0 ? size > threshold : size < threshold,
    );
    return hasContrastingSize ? threshold : undefined;
  }

  function analyzeDocumentStats(blocksByPage) {
    const allBlocks = blocksByPage.flat();
    const bodyFontSizes = allBlocks
      .filter((block) => block.fontSize)
      .map((block) => block.fontSize)
      .sort((a, b) => a - b);
    const medianBodyFontSize = bodyFontSizes.length
      ? bodyFontSizes[Math.floor(bodyFontSizes.length / 2)]
      : undefined;

    return {
      pageCount: blocksByPage.length,
      medianBodyFontSize,
      headingFontSizeThreshold: relativeFontSizeThreshold(
        bodyFontSizes, medianBodyFontSize, HEADING_FONT_SIZE_MARGIN, 1,
      ),
      footnoteFontSizeThreshold: relativeFontSizeThreshold(
        bodyFontSizes, medianBodyFontSize, FOOTNOTE_FONT_SIZE_MARGIN, -1,
      ),
      headerCandidates: collectEdgeCandidates(blocksByPage, isConfinedToHeaderZone),
      footerCandidates: collectEdgeCandidates(blocksByPage, isConfinedToFooterZone),
    };
  }

  const HEADER_FOOTER_MIN_REPETITION_RATE = 0.6;

  function findMatchingCandidate(candidates, block) {
    const normalizedText = normalizeCandidateText(block.text);
    const region = horizontalRegion(block.bbox);
    return candidates.find((candidate) => candidate.normalizedText === normalizedText && candidate.region === region);
  }

  function isConfidentHeaderFooterCandidate(candidate, pageCount) {
    return candidate.pages.length / pageCount >= HEADER_FOOTER_MIN_REPETITION_RATE;
  }

  function isStandalonePageNumberText(text) {
    return /^[-–—\s]*(\d+|[ivxlcdmIVXLCDM]+)[-–—\s]*$/.test(text.trim());
  }

  function isInEdgeZone(bbox) {
    return isConfinedToHeaderZone(bbox) || isConfinedToFooterZone(bbox);
  }

  function hasStablePageNumberProgression(candidates) {
    // A candidate list for page numbers groups by exact normalized text (research.md §5's
    // digit-placeholder normalization collapses distinct numbers to the same key), so its own
    // presence across pages already reflects stable formatting/position; require it to appear
    // on at least two pages to avoid promoting a single-page fluke.
    return candidates.pages.length >= 2;
  }

  // A bare page number (found via manual validation to sometimes be smaller than body text and
  // sit in the footer zone, e.g. "3") is page-number-shaped text, not footnote content — this
  // must be excluded regardless of whether the stricter, repetition-based page-number check
  // (hasStablePageNumberProgression) also fires, since a single-page sample never satisfies that
  // check for any individual page's own unique number.
  function isFootnoteCandidate(block, stats) {
    return (
      stats.footnoteFontSizeThreshold !== undefined
      && block.fontSize < stats.footnoteFontSizeThreshold
      && isConfinedToFooterZone(block.bbox)
      && !isStandalonePageNumberText(block.text)
    );
  }

  // A block is caption-like when it is isolated from its page neighbors by a much larger gap
  // than the page's own typical inter-block gap on both sides (a text-geometry proxy for
  // "adjacent to a non-text region," since this pipeline never inspects image content directly
  // — research.md §4) AND its font size differs from the document's body/heading profile,
  // corroborating position with styling per FR-012.
  const CAPTION_ISOLATION_GAP_MULTIPLIER = 3;

  function isCaptionCandidate(block, blocksOnPage, stats) {
    if (isInEdgeZone(block.bbox)) return false;
    if (stats.medianBodyFontSize === undefined) return false;
    if (Math.abs(block.fontSize - stats.medianBodyFontSize) < 1) return false;

    const others = blocksOnPage.filter((other) => other !== block);
    if (!others.length) return false;

    const gaps = others.map((other) => {
      if (other.bbox.y1 <= block.bbox.y0) return block.bbox.y0 - other.bbox.y1;
      if (other.bbox.y0 >= block.bbox.y1) return other.bbox.y0 - block.bbox.y1;
      return 0;
    });
    const typicalGap = median(
      others.slice(0, -1).map((_, index) => Math.max(0, others[index + 1].bbox.y0 - others[index].bbox.y1)),
    ) || 0.01;

    const gapAbove = Math.min(...gaps.filter((_, index) => others[index].bbox.y1 <= block.bbox.y0), Infinity);
    const gapBelow = Math.min(...gaps.filter((_, index) => others[index].bbox.y0 >= block.bbox.y1), Infinity);
    const isolatedAbove = gapAbove === Infinity || gapAbove > typicalGap * CAPTION_ISOLATION_GAP_MULTIPLIER;
    const isolatedBelow = gapBelow === Infinity || gapBelow > typicalGap * CAPTION_ISOLATION_GAP_MULTIPLIER;

    return isolatedAbove && isolatedBelow;
  }

  const TABLE_MIN_LINE_COUNT = 3;

  // Reuses findStableColumnGap's core "is there a region-spanning gap with items on both sides"
  // technique (built for two-column page layout) at CELL granularity — each line's own items,
  // not the merged line bbox, are what can show a stable left/right split — looking for that
  // gap to hold across 3+ lines as the corroborating "grid" signal FR-010 requires (a single
  // aligned pair of lines is not enough, per FR-012).
  function blockLooksLikeTable(block) {
    const lines = block.lines;
    if (!lines || lines.length < TABLE_MIN_LINE_COUNT) return false;
    if (!lines.every((line) => Array.isArray(line.items) && line.items.length >= 2)) return false;

    const allItems = lines.flatMap((line) => line.items);
    const top = Math.min(...allItems.map((item) => item.bbox.y0));
    const bottom = Math.max(...allItems.map((item) => item.bbox.y1));
    const gap = findStableColumnGap(allItems, top, bottom);
    if (!gap) return false;

    const linesWithBothSides = lines.filter((line) =>
      line.items.some((item) => item.bbox.x1 <= gap.gapStart + 1e-6)
      && line.items.some((item) => item.bbox.x0 >= gap.gapEnd - 1e-6),
    );
    return linesWithBothSides.length >= TABLE_MIN_LINE_COUNT;
  }

  function classifyBlocks(blocksByPage, stats) {
    const pageCount = stats.pageCount || blocksByPage.length;

    return blocksByPage.map((blocks) =>
      blocks.map((block) => {
        const isEdgeLine = isInEdgeZone(block.bbox);

        if (isEdgeLine && isStandalonePageNumberText(block.text)) {
          const candidate = findMatchingCandidate(
            [...stats.headerCandidates, ...stats.footerCandidates],
            block,
          );
          if (candidate && hasStablePageNumberProgression(candidate)) {
            return { ...block, type: "page-number", confidence: candidate.pages.length / pageCount };
          }
        }

        const headerCandidate = findMatchingCandidate(stats.headerCandidates, block);
        if (headerCandidate && isConfidentHeaderFooterCandidate(headerCandidate, pageCount)) {
          return { ...block, type: "header", confidence: headerCandidate.pages.length / pageCount };
        }

        const footerCandidate = findMatchingCandidate(stats.footerCandidates, block);
        if (footerCandidate && isConfidentHeaderFooterCandidate(footerCandidate, pageCount)) {
          return { ...block, type: "footer", confidence: footerCandidate.pages.length / pageCount };
        }

        if (
          stats.headingFontSizeThreshold !== undefined
          && block.fontSize > stats.headingFontSizeThreshold
          && block.text.trim().length > 1
        ) {
          return { ...block, type: "heading", confidence: 1 };
        }

        if (isFootnoteCandidate(block, stats)) {
          return { ...block, type: "footnote", confidence: 1 };
        }

        if (blockLooksLikeTable(block)) {
          return { ...block, type: "table", confidence: 1 };
        }

        if (isCaptionCandidate(block, blocks, stats)) {
          return { ...block, type: "caption", confidence: 1 };
        }

        return block;
      }),
    );
  }

  const FULL_WIDTH_THRESHOLD = 0.75;
  const COLUMN_GAP_MIN_HEIGHT_COVERAGE = 0.5;
  const MIN_COLUMN_GAP_WIDTH = 0.03;

  function isFullWidthBlock(block, pageBodyWidth) {
    return block.bbox.x1 - block.bbox.x0 >= pageBodyWidth * FULL_WIDTH_THRESHOLD;
  }

  function findStableColumnGap(narrowBlocks, bodyTop, bodyBottom) {
    const bodyHeight = bodyBottom - bodyTop || 1;
    const boundaries = [...new Set(narrowBlocks.flatMap((block) => [block.bbox.x0, block.bbox.x1]))].sort((a, b) => a - b);

    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const gapStart = boundaries[index];
      const gapEnd = boundaries[index + 1];
      const gapWidth = gapEnd - gapStart;
      if (gapWidth < MIN_COLUMN_GAP_WIDTH) continue;

      const blocksLeft = narrowBlocks.filter((block) => block.bbox.x1 <= gapStart + 1e-6);
      const blocksRight = narrowBlocks.filter((block) => block.bbox.x0 >= gapEnd - 1e-6);
      if (!blocksLeft.length || !blocksRight.length) continue;

      const spanningHeight = (blocks) => {
        const minY = Math.min(...blocks.map((block) => block.bbox.y0));
        const maxY = Math.max(...blocks.map((block) => block.bbox.y1));
        return maxY - minY;
      };
      const coverage = Math.min(spanningHeight(blocksLeft), spanningHeight(blocksRight)) / bodyHeight;
      if (coverage >= COLUMN_GAP_MIN_HEIGHT_COVERAGE) {
        return { gapStart, gapEnd };
      }
    }

    return null;
  }

  function detectColumns(blocksByPage) {
    return blocksByPage.map((blocks) => {
      if (!blocks.length) return blocks;

      const bodyLeft = Math.min(...blocks.map((block) => block.bbox.x0));
      const bodyRight = Math.max(...blocks.map((block) => block.bbox.x1));
      const bodyTop = Math.min(...blocks.map((block) => block.bbox.y0));
      const bodyBottom = Math.max(...blocks.map((block) => block.bbox.y1));
      const bodyWidth = bodyRight - bodyLeft || 1;

      const narrowBlocks = blocks.filter((block) => !isFullWidthBlock(block, bodyWidth));
      const gap = findStableColumnGap(narrowBlocks, bodyTop, bodyBottom);

      if (!gap) {
        return blocks.map((block) => ({ ...block, column: undefined }));
      }

      return blocks.map((block) => {
        if (isFullWidthBlock(block, bodyWidth)) return { ...block, column: undefined };
        const center = (block.bbox.x0 + block.bbox.x1) / 2;
        return { ...block, column: center <= gap.gapStart ? 0 : 1 };
      });
    });
  }

  function resolveTwoColumnOrder(blocks) {
    const sortByTop = (list) => [...list].sort((a, b) => a.bbox.y0 - b.bbox.y0);
    const fullWidth = sortByTop(blocks.filter((block) => block.column === undefined));
    const leftColumn = sortByTop(blocks.filter((block) => block.column === 0));
    const rightColumn = sortByTop(blocks.filter((block) => block.column === 1));

    // A full-width block (title, section heading spanning both columns) breaks the page into
    // segments; within each segment the left column reads to completion, then the right
    // column, then the next full-width block (research.md §8) — a full-width block never
    // splits reading mid-way through either column, since "read the left column, then the
    // right column" only makes sense as whole runs between such breaks.
    const boundaries = [-Infinity, ...fullWidth.map((block) => block.bbox.y0), Infinity];
    const ordered = [];

    for (let segment = 0; segment < boundaries.length - 1; segment += 1) {
      const segmentStart = boundaries[segment];
      const segmentEnd = boundaries[segment + 1];
      const inSegment = (block) => block.bbox.y0 >= segmentStart && block.bbox.y0 < segmentEnd;

      ordered.push(...leftColumn.filter(inSegment));
      ordered.push(...rightColumn.filter(inSegment));
      if (segment < fullWidth.length) ordered.push(fullWidth[segment]);
    }

    return ordered;
  }

  function resolveReadingOrder(blocksByPage, columnLayoutByPage) {
    return blocksByPage.map((blocks, pageIndex) => {
      const layout = columnLayoutByPage[pageIndex];
      if (layout !== "two-column") return blocks;
      return resolveTwoColumnOrder(blocks);
    });
  }

  // The single default speech policy (data-model.md): reproduces NARRATION_EXCLUDED_TYPES's old
  // per-type behavior exactly (FR-001/FR-002). speakTitles/speakCitations/speakReferences are
  // forward-compatible fields with no effect yet — no distinct title/citation/reference block
  // type exists in this pipeline (research.md Decision 1, spec 005).
  const DEFAULT_SPEECH_POLICY = {
    speakTitles: true,
    speakHeadings: true,
    speakPageNumbers: false,
    speakHeaders: false,
    speakFooters: false,
    speakFootnotes: false,
    speakCaptions: false,
    speakCitations: false,
    speakReferences: false,
    tables: "skip",
  };

  function resolveSpeechPolicy(overrides) {
    return { ...DEFAULT_SPEECH_POLICY, ...(overrides || {}) };
  }

  // The single source of truth for whether a block type should be spoken under a given policy
  // (research.md Decision 2, spec 005) — both toAstBlock's speak-flag derivation and
  // renderNarrationText's inclusion filter call this instead of each independently re-encoding
  // the decision, closing the two-copies drift risk NARRATION_EXCLUDED_TYPES had.
  function shouldSpeak(type, policy) {
    switch (type) {
      case "heading": return policy.speakHeadings;
      case "header": return policy.speakHeaders;
      case "footer": return policy.speakFooters;
      case "page-number": return policy.speakPageNumbers;
      case "footnote": return policy.speakFootnotes;
      case "caption": return policy.speakCaptions;
      case "table": return policy.tables !== "skip";
      default: return true;
    }
  }

  // Maps one already-classified, already-id-assigned, reading-order-resolved block (the internal
  // working shape used by classifyBlocks/resolveReadingOrder) to the public Block schema
  // (data-model.md): carries forward id/page/type/text/bbox/confidence, nests fontSize under
  // style.fontSize, assigns readingOrder from position in the flattened sequence, and derives
  // speak from the given speech policy via the single shouldSpeak source of truth (spec 005).
  function toAstBlock(block, readingOrder, policy) {
    const astBlock = {
      id: block.id,
      page: block.page,
      type: block.type,
      text: block.text,
      readingOrder,
      speak: shouldSpeak(block.type, policy),
    };
    if (block.bbox) astBlock.bbox = block.bbox;
    if (block.fontSize !== undefined) astBlock.style = { fontSize: block.fontSize };
    if (block.confidence !== undefined) astBlock.confidence = block.confidence;
    return astBlock;
  }

  // Single linear pass (research.md Decision 2): each heading-typed block starts a new section
  // under that heading's title; any blocks before the first heading (or every block, when there
  // is no heading anywhere) form one leading implicit section with no title.
  function groupBlocksIntoSections(astBlocks) {
    const sections = [];
    let currentSection = null;

    astBlocks.forEach((block) => {
      if (block.type === "heading" || !currentSection) {
        currentSection = {
          id: `section-${block.id}`,
          type: "section",
          level: 1,
          title: block.type === "heading" ? block.text : undefined,
          blocks: [],
        };
        sections.push(currentSection);
      }
      currentSection.blocks.push(block);
    });

    return sections;
  }

  function buildDocumentAst(orderedBlocksByPage, policy) {
    const resolvedPolicy = resolveSpeechPolicy(policy);
    const astBlocks = orderedBlocksByPage.flat().map((block, index) => toAstBlock(block, index, resolvedPolicy));

    return {
      title: "",
      sections: astBlocks.length ? groupBlocksIntoSections(astBlocks) : [],
    };
  }

  const CITATION_MARKER_PATTERN = /\[\d+(?:[,\-–]\s*\d+)*\]/g;
  const BARE_URL_PATTERN = /https?:\/\/\S+/g;

  function joinBlockLinesWithDehyphenation(block) {
    const lines = block.lines && block.lines.length ? block.lines : [{ text: block.text }];
    let joined = "";

    lines.forEach((line, index) => {
      if (index === 0) {
        joined = line.text;
        return;
      }
      if (/[A-Za-z]-$/.test(joined) && /^[a-z]/.test(line.text)) {
        joined = `${joined.slice(0, -1)}${line.text}`;
      } else {
        joined = `${joined} ${line.text}`;
      }
    });

    return joined;
  }

  function stripCitationsAndUrls(text) {
    return text.replace(CITATION_MARKER_PATTERN, "").replace(BARE_URL_PATTERN, "").replace(/[ \t]{2,}/g, " ").trim();
  }

  // research.md Decision 1: hand-written cardinal-to-words, grouped into 3-digit chunks from the
  // most significant end (short-scale English). No "and" inside a cardinal itself (e.g. "one
  // hundred five", not "one hundred and five") — reserved for currency's cents clause only.
  const ONES_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const TENS_WORDS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const SCALE_WORDS = ["", "thousand", "million", "billion", "trillion"];

  function twoDigitsToWords(n) {
    if (n < 20) return ONES_WORDS[n];
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return ones === 0 ? TENS_WORDS[tens] : `${TENS_WORDS[tens]}-${ONES_WORDS[ones]}`;
  }

  function threeDigitGroupToWords(n) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    const parts = [];
    if (hundreds > 0) parts.push(`${ONES_WORDS[hundreds]} hundred`);
    if (rest > 0) parts.push(twoDigitsToWords(rest));
    return parts.join(" ");
  }

  // OWASP A08:2025 Mishandling of Exceptional Conditions - a digit run longer than this pipeline
  // can name (beyond "trillion", SCALE_WORDS' last entry) must not attempt conversion: without
  // this guard, a number exceeding Number.MAX_SAFE_INTEGER degrades to Infinity, whose modulo is
  // NaN while its quotient stays Infinity, making the group-extraction loop below never
  // terminate — a single adversarial digit run of a few hundred characters would otherwise hang
  // the reader indefinitely. FR-013 already requires leaving an unclassifiable span as printed
  // text, and this is exactly that case: a number too large for this spec's named scale words.
  const MAX_CONVERTIBLE_DIGITS = SCALE_WORDS.length * 3;

  // Exposed separately from convertCardinal so every converter that builds phrasing around a
  // cardinal-converted whole-number part (currency, percentage, decimal) can check this first
  // and, if true, return its own full original match unmodified instead of wrapping the raw,
  // unconverted digits in unit/format words — otherwise FR-013's "leave unclassifiable content
  // unmodified" guarantee would hold for convertCardinal alone but not for its callers
  // (Convergence T051).
  function exceedsConvertibleDigits(digitsText) {
    return digitsText.replace(/,/g, "").replace(/^0+/, "").length > MAX_CONVERTIBLE_DIGITS;
  }

  function convertCardinal(digitsText) {
    if (exceedsConvertibleDigits(digitsText)) return digitsText;
    const digitsOnly = digitsText.replace(/,/g, "");

    const n = parseInt(digitsOnly, 10);
    if (n === 0) return "zero";

    const groups = [];
    let remaining = n;
    while (remaining > 0) {
      groups.unshift(remaining % 1000);
      remaining = Math.floor(remaining / 1000);
    }

    const scaleIndexOffset = groups.length - 1;
    return groups
      .map((group, index) => {
        if (group === 0) return "";
        const scaleWord = SCALE_WORDS[scaleIndexOffset - index];
        return scaleWord ? `${threeDigitGroupToWords(group)} ${scaleWord}` : threeDigitGroupToWords(group);
      })
      .filter(Boolean)
      .join(" ");
  }

  const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

  function convertCodeDigits(digitsText) {
    return digitsText
      .split("")
      .filter((char) => /\d/.test(char))
      .map((digit) => DIGIT_WORDS[Number(digit)])
      .join(" ");
  }

  const CURRENCY_UNIT_WORDS = {
    $: { singular: "dollar", plural: "dollars" },
    "£": { singular: "pound", plural: "pounds" },
    "€": { singular: "euro", plural: "euros" },
  };

  const MAGNITUDE_WORDS = {
    k: "thousand",
    m: "million",
    mn: "million",
    million: "million",
    b: "billion",
    bn: "billion",
    billion: "billion",
    t: "trillion",
    tn: "trillion",
    trillion: "trillion",
  };

  function convertCurrency(matchText) {
    const parsed = matchText.match(/^([$£€])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(k|m|mn|million|b|bn|billion|t|tn|trillion)?$/i);
    const [, symbol, wholePart, fractionPart, magnitudeSuffix] = parsed;
    if (exceedsConvertibleDigits(wholePart)) return matchText;
    const unitWords = CURRENCY_UNIT_WORDS[symbol];

    if (magnitudeSuffix) {
      const magnitudeWord = MAGNITUDE_WORDS[magnitudeSuffix.toLowerCase()];
      const amountWords = fractionPart
        ? `${convertCardinal(wholePart)} point ${fractionPart.split("").map((digit) => DIGIT_WORDS[Number(digit)]).join(" ")}`
        : convertCardinal(wholePart);
      return `${amountWords} ${magnitudeWord} ${unitWords.plural}`;
    }

    const wholeValue = parseInt(wholePart.replace(/,/g, ""), 10);
    const wholeUnit = wholeValue === 1 ? unitWords.singular : unitWords.plural;
    if (!fractionPart) return `${convertCardinal(wholePart)} ${wholeUnit}`;

    const cents = parseInt(fractionPart.padEnd(2, "0").slice(0, 2), 10);
    const centsWord = cents === 1 ? "cent" : "cents";
    return `${convertCardinal(wholePart)} ${wholeUnit} and ${convertCardinal(String(cents))} ${centsWord}`;
  }

  // data-model.md's year mapping: split into two 2-digit groups, except the 2000-2009 range
  // which is spoken as "two thousand" (+ the trailing cardinal, if non-zero) rather than as two
  // groups (there is no natural "twenty-oh-three" pairing for a leading zero group).
  function convertYear(digitsText) {
    const n = parseInt(digitsText, 10);
    const firstTwo = Math.floor(n / 100);
    const lastTwo = n % 100;

    if (firstTwo === 20 && lastTwo < 10) {
      return lastTwo === 0 ? "two thousand" : `two thousand ${ONES_WORDS[lastTwo]}`;
    }

    const firstWords = twoDigitsToWords(firstTwo);
    const lastWords = lastTwo === 0 ? "hundred" : twoDigitsToWords(lastTwo);
    return `${firstWords} ${lastWords}`;
  }

  // Returns null (rather than throwing or guessing) when the whole-number part exceeds this
  // pipeline's convertible range, so callers can fall back to their own full original match
  // text unmodified (FR-013, Convergence T051) instead of wrapping raw digits in "point ...".
  function decimalToWords(digitsText) {
    const [wholePart, fractionPart] = digitsText.split(".");
    if (exceedsConvertibleDigits(wholePart)) return null;
    const wholeWords = convertCardinal(wholePart);
    const fractionWords = fractionPart.split("").map((digit) => DIGIT_WORDS[Number(digit)]).join(" ");
    return `${wholeWords} point ${fractionWords}`;
  }

  function convertPercentage(matchText) {
    const numberText = matchText.slice(0, -1);
    if (numberText.includes(".")) {
      const decimalWords = decimalToWords(numberText);
      return decimalWords === null ? matchText : `${decimalWords} percent`;
    }
    if (exceedsConvertibleDigits(numberText)) return matchText;
    return `${convertCardinal(numberText)} percent`;
  }

  function convertDecimal(matchText) {
    const decimalWords = decimalToWords(matchText);
    return decimalWords === null ? matchText : decimalWords;
  }

  const IRREGULAR_ORDINAL_WORDS = {
    one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth",
  };

  function ordinalWordFor(cardinalWord) {
    if (IRREGULAR_ORDINAL_WORDS[cardinalWord]) return IRREGULAR_ORDINAL_WORDS[cardinalWord];
    if (cardinalWord.endsWith("y")) return `${cardinalWord.slice(0, -1)}ieth`;
    return `${cardinalWord}th`;
  }

  // Ordinal words only ever differ from cardinal words in their final word (e.g.
  // "twenty-one" -> "twenty-first"; "one hundred" -> "one hundredth") — splitting on the last
  // separator (space or hyphen) and replacing only that trailing word keeps this simple rather
  // than pattern-matching every possible cardinal shape.
  function convertOrdinal(matchText) {
    const digitsText = matchText.replace(/(st|nd|rd|th)$/i, "");
    const cardinalWords = convertCardinal(digitsText);
    const lastSeparatorIndex = Math.max(cardinalWords.lastIndexOf(" "), cardinalWords.lastIndexOf("-"));
    if (lastSeparatorIndex === -1) return ordinalWordFor(cardinalWords);

    const prefix = cardinalWords.slice(0, lastSeparatorIndex + 1);
    const lastWord = cardinalWords.slice(lastSeparatorIndex + 1);
    return `${prefix}${ordinalWordFor(lastWord)}`;
  }

  // research.md Decision 2: a fixed priority-ordered scan. Each detector below returns matches
  // as {start, end, match} in the given text; detectNumericEntities merges them left-to-right,
  // letting an earlier-priority detector's match claim its range so no later detector can
  // re-match a sub-span of it (e.g. currency claims "$1998" before the year detector ever runs
  // over that range). Bounded, non-nested regex quantifiers throughout (research.md Decision 4)
  // — no pattern nests one unbounded quantifier inside another, keeping detection linear in
  // input length regardless of digit-run or separator-run size.
  const CARDINAL_PATTERN = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  const CURRENCY_PATTERN = /[$£€](?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:k|m|mn|million|b|bn|billion|t|tn|trillion)?\b/gi;
  const CODE_LABEL_PATTERN = /(?:PIN|code|ext|extension|ID|#)\s*(\d[\d\s-]*\d|\d)/gi;
  const PHONE_SHAPED_PATTERN = /\+?\d{1,4}(?:[\s-]\d{2,4}){2,}/g;
  const PERCENTAGE_PATTERN = /\d+(?:\.\d+)?%/g;
  const ORDINAL_PATTERN = /\d+(?:st|nd|rd|th)\b/gi;
  const DECIMAL_PATTERN = /\d+\.\d+/g;

  function findNonOverlapping(text, pattern, category, claimed) {
    const matches = [];
    const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (claimed.some((range) => start < range.end && end > range.start)) continue;
      matches.push({ category, start, end, match: match[0] });
    }
    return matches;
  }

  function claimEntities(matches, claimed, entities, spokenFor) {
    matches.forEach((entity) => {
      entity.spoken = spokenFor(entity.match);
      claimed.push({ start: entity.start, end: entity.end });
      entities.push(entity);
    });
  }

  function detectNumericEntities(text) {
    const claimed = [];
    const entities = [];

    claimEntities(findNonOverlapping(text, CURRENCY_PATTERN, "currency", claimed), claimed, entities, convertCurrency);

    const labelCodeMatches = findNonOverlapping(text, CODE_LABEL_PATTERN, "code", claimed)
      .map((entity) => ({ ...entity, spokenDigits: entity.match.match(/\d[\d\s-]*\d|\d/)[0] }));
    const phoneCodeMatches = findNonOverlapping(text, PHONE_SHAPED_PATTERN, "code", claimed)
      .map((entity) => ({ ...entity, spokenDigits: entity.match }));
    [...labelCodeMatches, ...phoneCodeMatches].forEach((entity) => {
      const digitsOnly = entity.spokenDigits;
      const labelPrefix = entity.match.slice(0, entity.match.length - digitsOnly.length);
      entity.spoken = `${labelPrefix}${convertCodeDigits(digitsOnly)}`;
      claimed.push({ start: entity.start, end: entity.end });
      entities.push(entity);
    });

    // FR-005: a bare 4-digit number in 1000-2099 is a year UNLESS immediately preceded by a
    // currency symbol or immediately followed by a unit/count word — those exceptions are
    // checked via lookbehind/lookahead so a plain YEAR_PATTERN match can be rejected in place,
    // falling through to the cardinal detector below rather than needing a separate pass.
    const UNIT_WORD_PATTERN = /^(units?|items?|pages?|dollars?|pounds?|euros?)\b/i;
    const YEAR_PATTERN = /(?<![$£€])\b(1[0-9]{3}|20[0-9]{2})\b/g;
    const yearMatches = findNonOverlapping(text, YEAR_PATTERN, "year", claimed).filter((entity) => {
      const following = text.slice(entity.end).replace(/^[\s,]*/, "");
      return !UNIT_WORD_PATTERN.test(following);
    });
    claimEntities(yearMatches, claimed, entities, convertYear);

    claimEntities(findNonOverlapping(text, PERCENTAGE_PATTERN, "percentage", claimed), claimed, entities, convertPercentage);
    claimEntities(findNonOverlapping(text, ORDINAL_PATTERN, "ordinal", claimed), claimed, entities, convertOrdinal);
    claimEntities(findNonOverlapping(text, DECIMAL_PATTERN, "decimal", claimed), claimed, entities, convertDecimal);

    claimEntities(findNonOverlapping(text, CARDINAL_PATTERN, "cardinal", claimed), claimed, entities, convertCardinal);

    entities.sort((a, b) => a.start - b.start);
    return entities;
  }

  function normalizeSpokenText(text) {
    const entities = detectNumericEntities(text);
    if (!entities.length) return text;

    let result = "";
    let cursor = 0;
    entities.forEach((entity) => {
      result += text.slice(cursor, entity.start);
      result += entity.spoken;
      cursor = entity.end;
    });
    result += text.slice(cursor);
    return result;
  }

  function renderNarrationText(orderedBlocksByPage, policy) {
    const resolvedPolicy = resolveSpeechPolicy(policy);
    const narratableBlocks = orderedBlocksByPage
      .flat()
      .filter((block) => shouldSpeak(block.type, resolvedPolicy));

    const joinedText = narratableBlocks.map(joinBlockLinesWithDehyphenation).join("\n\n");
    return normalizeSpokenText(stripCitationsAndUrls(joinedText));
  }

  // research.md Decision 2, spec.md Assumptions: a fixed, non-extensible abbreviation list.
  const PROTECTED_ABBREVIATIONS = ["Dr.", "Mr.", "Mrs.", "Prof.", "vs.", "approx.", "etc.", "e.g.", "i.e.", "St.", "Jr.", "Sr."];

  function isProtectedAbbreviationPeriod(text, position) {
    if (position >= text.length) return false;
    return PROTECTED_ABBREVIATIONS.some((abbreviation) => text.slice(0, position).endsWith(abbreviation));
  }

  const RAW_DECIMAL_PATTERN = /\d+\.\d+/g;

  // True when `position` falls strictly inside a raw digit.digit decimal number (e.g. "3.14")
  // — a raw decimal that could still reach the chunker unconverted (FR-003's defensive
  // requirement). Protects the whole matched span, not just the position of the "." itself.
  const NUMBER_WORD_RUN_PATTERN = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|point|and)(?:[\s-]+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|point|and))*\b/gi;

  function isProtectedDecimal(text, position) {
    const rawRegex = new RegExp(RAW_DECIMAL_PATTERN.source, RAW_DECIMAL_PATTERN.flags);
    let match;
    while ((match = rawRegex.exec(text)) !== null) {
      if (position > match.index && position < match.index + match[0].length) return true;
    }

    // Spoken-form decimal: a number-word run containing "point" (e.g. "three point one four")
    // — the same NUMBER_WORD_RUN_PATTERN used by currency-phrase detection, applied standalone
    // since a spoken decimal need not be adjacent to a currency unit noun.
    const wordRunRegex = new RegExp(NUMBER_WORD_RUN_PATTERN.source, NUMBER_WORD_RUN_PATTERN.flags);
    while ((match = wordRunRegex.exec(text)) !== null) {
      if (!/\bpoint\b/i.test(match[0])) continue;
      if (position > match.index && position < match.index + match[0].length) return true;
    }
    return false;
  }

  const CURRENCY_UNIT_NOUN_PATTERN = /\b(?:dollars?|pounds?|euros?|cents?)\b/gi;

  // True when `position` falls inside a spoken currency phrase: a number-word run immediately
  // before a currency unit noun (dollar/dollars/pound/pounds/euro/euros), or within the
  // "<number> and <number> cent(s)" cents clause (FR-004). Scans for the unit noun, then extends
  // the protected range backward to include the number-word run (and any "and ... cents" clause)
  // immediately preceding it.
  function isProtectedCurrencyPhrase(text, position) {
    const unitNounRegex = new RegExp(CURRENCY_UNIT_NOUN_PATTERN.source, CURRENCY_UNIT_NOUN_PATTERN.flags);
    let match;
    while ((match = unitNounRegex.exec(text)) !== null) {
      const numberRunRegex = new RegExp(NUMBER_WORD_RUN_PATTERN.source, NUMBER_WORD_RUN_PATTERN.flags);
      let numberMatch;
      let rangeStart = match.index;
      while ((numberMatch = numberRunRegex.exec(text)) !== null) {
        const gapText = text.slice(numberMatch.index + numberMatch[0].length, match.index);
        if (/^\s*$/.test(gapText)) rangeStart = Math.min(rangeStart, numberMatch.index);
      }
      const rangeEnd = match.index + match[0].length;
      if (position > rangeStart && position < rangeEnd) return true;
    }
    return false;
  }

  const ORDINAL_WORD_ENDING_PATTERN = /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\w+ieth|\w+th)\b/gi;

  // True when `position` falls inside a spoken ordinal word run (e.g. "twenty-first") — a
  // hyphen-joined word run ending in an ordinal word, or the ordinal word alone (FR-005).
  function isProtectedOrdinal(text, position) {
    const ordinalRegex = new RegExp(ORDINAL_WORD_ENDING_PATTERN.source, ORDINAL_WORD_ENDING_PATTERN.flags);
    let match;
    while ((match = ordinalRegex.exec(text)) !== null) {
      const precedingWordRun = text.slice(0, match.index).match(/[A-Za-z]+-$/);
      const rangeStart = precedingWordRun ? match.index - precedingWordRun[0].length : match.index;
      const rangeEnd = match.index + match[0].length;
      if (position > rangeStart && position < rangeEnd) return true;
    }
    return false;
  }

  const YEAR_WORD_PHRASE_PATTERN = /\b(?:nineteen|twenty)[\s-]+(?:oh[\s-]+\w+|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:-\w+)?|thirty(?:-\w+)?|forty(?:-\w+)?|fifty(?:-\w+)?|sixty(?:-\w+)?|seventy(?:-\w+)?|eighty(?:-\w+)?|ninety(?:-\w+)?)\b|\btwo thousand(?:[\s-]+\w+)?\b/gi;

  // True when `position` falls inside a spoken year phrase (e.g. "twenty twenty-four", "two
  // thousand five") — the two-part year-shaped word run spec 006's convertYear produces (FR-005).
  function isProtectedYearPhrase(text, position) {
    const yearRegex = new RegExp(YEAR_WORD_PHRASE_PATTERN.source, YEAR_WORD_PHRASE_PATTERN.flags);
    let match;
    while ((match = yearRegex.exec(text)) !== null) {
      if (position > match.index && position < match.index + match[0].length) return true;
    }
    return false;
  }

  // Single dispatch point for all protected-span detectors (research.md Decision 2).
  function isProtectedPosition(text, position) {
    return (
      isProtectedAbbreviationPeriod(text, position)
      || isProtectedDecimal(text, position)
      || isProtectedCurrencyPhrase(text, position)
      || isProtectedOrdinal(text, position)
      || isProtectedYearPhrase(text, position)
    );
  }

  // research.md Decision 1 (revised): each tier's regex identifies where that tier's boundary
  // falls; the boundary "position" is the offset right after the punctuation/whitespace run, so
  // splitting at it never drops or duplicates a character. Bounded, non-nested quantifiers only
  // (research.md's Security Review commitment, mirroring spec 006's Decision 4).
  const BOUNDARY_PATTERNS = {
    paragraph: /\n\n/g,
    sentence: /[.!?]+["')\]]*\s+(?=\S)/g,
    clause: /[,;]\s+(?=\S)/g,
    plain: /[:\-–—]\s+(?=\S)/g,
  };

  function findBoundaryCandidates(text, tier) {
    const pattern = BOUNDARY_PATTERNS[tier];
    const regex = new RegExp(pattern.source, pattern.flags);
    const candidates = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      const position = match.index + match[0].length;
      // Protection is checked right after the punctuation mark itself (match.index + 1), not
      // at the boundary position (which is after any trailing whitespace) — an abbreviation
      // period is exactly one character, so this is where isProtectedAbbreviationPeriod expects
      // "further text" to begin.
      if (isProtectedPosition(text, match.index + 1)) continue;
      candidates.push({ position, tier });
    }
    return candidates;
  }

  // Tiers this pipeline always splits at unconditionally, regardless of length — this is the
  // pre-007 chunker's own granularity (it always split into sentences, never merging adjacent
  // short ones; verified directly against "First passage. Second passage." producing two
  // chunks). Clause/plain are used only conditionally, as fallbacks for a piece that is still
  // too long after unconditional splitting (research.md Decision 1, revised).
  const UNCONDITIONAL_TIERS = ["paragraph", "sentence"];
  const CONDITIONAL_TIERS = ["clause", "plain"];
  const TIER_ORDER = [...UNCONDITIONAL_TIERS, ...CONDITIONAL_TIERS];

  // research.md Decision 3's true last resort, reached only when no punctuation-based tier
  // (paragraph/sentence/clause/plain) can further split an oversized piece. Unlike the
  // unmodified splitLongText (used only for the pathological single-unsplittable-word/protected-
  // span case), this greedily packs whole words up to maxLength while still respecting
  // protected-span boundaries — this is what keeps a long punctuation-free passage containing a
  // protected phrase (e.g. "...is three point one four in...") from being split mid-phrase by a
  // naive word-by-word wrap that knows nothing about protection.
  function packWordsRespectingProtection(text, maxLength) {
    const words = text.split(/\s+/).filter(Boolean);
    const chunks = [];
    let current = "";
    let cursorInText = 0;

    words.forEach((word) => {
      const wordStart = text.indexOf(word, cursorInText);
      cursorInText = wordStart + word.length;

      // A single word longer than maxLength on its own can't be packed at all — split it
      // character-by-character, matching splitLongText's own handling of this pathological case
      // (Security Review/FR-008: this is what guarantees termination and a bounded chunk size
      // even for a single unsplittable, unpunctuated run).
      if (word.length > maxLength) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        for (let index = 0; index < word.length; index += maxLength) {
          chunks.push(word.slice(index, index + maxLength));
        }
        return;
      }

      const candidate = current ? `${current} ${word}` : word;
      const boundaryIsProtected = current && isProtectedPosition(text, wordStart);

      if (candidate.length > maxLength && current && !boundaryIsProtected) {
        chunks.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });

    if (current) chunks.push(current);
    return chunks;
  }

  function splitAtTierUnconditionally(text, tier) {
    const candidates = findBoundaryCandidates(text, tier);
    if (!candidates.length) return [text];

    const pieces = [];
    let cursor = 0;
    candidates.forEach((candidate) => {
      pieces.push(text.slice(cursor, candidate.position).trim());
      cursor = candidate.position;
    });
    pieces.push(text.slice(cursor).trim());
    return pieces.filter(Boolean);
  }

  // research.md Decision 1 (revised): paragraph and sentence tiers always split (matching the
  // pre-007 chunker's granularity, per FR-009); a resulting piece that is still too long then
  // descends through clause and plain-punctuation tiers only as needed, finally falling back to
  // the existing, already-terminating splitLongText. No tier ever merges pieces back together.
  function splitByTier(text, tier, maxLength) {
    const tierIndex = TIER_ORDER.indexOf(tier);
    const nextTier = TIER_ORDER[tierIndex + 1];
    const descend = (piece) => (nextTier ? splitByTier(piece, nextTier, maxLength) : packWordsRespectingProtection(piece, maxLength));
    const descendUnconditionally = (piece) => (nextTier ? splitByTier(piece, nextTier, maxLength) : [piece]);

    if (UNCONDITIONAL_TIERS.includes(tier)) {
      const pieces = splitAtTierUnconditionally(text, tier);
      const isNextTierUnconditional = nextTier && UNCONDITIONAL_TIERS.includes(nextTier);
      return pieces.flatMap((piece) => {
        if (isNextTierUnconditional) return descendUnconditionally(piece);
        return piece.length <= maxLength ? [piece] : descend(piece);
      });
    }

    if (text.length <= maxLength) return [text];
    const pieces = splitAtTierUnconditionally(text, tier);
    if (pieces.length === 1) return descend(text);
    return pieces.flatMap((piece) => (piece.length <= maxLength ? [piece] : descend(piece)));
  }

  function splitLongText(text, maxLength) {
    const words = text.split(/\s+/).filter(Boolean);
    const chunks = [];
    let current = "";

    for (const word of words) {
      if (word.length > maxLength) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        for (let index = 0; index < word.length; index += maxLength) {
          chunks.push(word.slice(index, index + maxLength));
        }
        continue;
      }

      const next = current ? `${current} ${word}` : word;
      if (next.length > maxLength && current) {
        chunks.push(current);
        current = word;
      } else {
        current = next;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  function splitIntoSpeechChunks(text, maxLength = 260) {
    const normalized = normalizePdfText(text);
    if (!normalized) return [];

    return splitByTier(normalized, "paragraph", maxLength);
  }

  function normalizedWordSet(text) {
    return new Set(String(text || "").toLowerCase().match(/[a-z0-9']+/g) || []);
  }

  function wordOverlapScore(a, b) {
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const word of a) {
      if (b.has(word)) shared += 1;
    }
    return shared / Math.max(a.size, b.size);
  }

  // Maps each display paragraph to its best-matching narration chunk index, for click-to-jump
  // in the literal (default) reading pane. Display text and narration text can diverge
  // (headers/footers/citations/URLs removed, columns reordered, per FR-009/research.md §10),
  // so an exact match isn't always possible — a paragraph with no good match (e.g. a removed
  // header) falls back to the nearest chunk by position rather than mapping to nothing.
  function mapParagraphsToChunks(paragraphs, chunks) {
    if (!chunks.length) return paragraphs.map(() => null);

    const chunkWordSets = chunks.map(normalizedWordSet);
    const rawMatches = paragraphs.map((paragraph) => {
      const paragraphWords = normalizedWordSet(paragraph);
      let bestIndex = -1;
      let bestScore = 0;
      chunkWordSets.forEach((chunkWords, index) => {
        const score = wordOverlapScore(paragraphWords, chunkWords);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });
      return bestScore > 0 ? bestIndex : null;
    });

    let lastKnown = 0;
    const forwardFilled = rawMatches.map((match) => {
      if (match !== null) {
        lastKnown = match;
        return match;
      }
      return lastKnown;
    });

    return forwardFilled;
  }

  function renderExtractedText(container, text) {
    // OWASP A07:2025 Injection - PDF content is untrusted, so render only as text.
    container.textContent = text;
  }

  function renderSpeechFocus(container, fullText, focusText, fromIndex = 0) {
    const text = String(fullText || "");
    const focus = String(focusText || "");
    const start = focus ? text.indexOf(focus, Math.max(0, fromIndex)) : -1;

    if (start < 0 || !container.ownerDocument || typeof container.replaceChildren !== "function") {
      renderExtractedText(container, text);
      return -1;
    }

    const end = start + focus.length;
    const doc = container.ownerDocument;
    const before = doc.createTextNode(text.slice(0, start));
    const active = doc.createElement("span");
    const after = doc.createTextNode(text.slice(end));

    active.className = "sentence-focus";
    active.textContent = focus;
    active.setAttribute("data-magnifier", "");
    container.replaceChildren(before, active, after);
    if (typeof active.scrollIntoView === "function") {
      const reduceMotion = globalScope.matchMedia
        && globalScope.matchMedia("(prefers-reduced-motion: reduce)").matches;
      active.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }
    return end;
  }

  const LARGE_DOCUMENT_PAGE_THRESHOLD = 200;

  function checkHasRealWorker(probeRealWorker) {
    const hasWorkerConstructor = typeof globalScope.Worker === "function";

    // Always run the caller's probe when given one, even if no Worker constructor exists —
    // extractPdfText's probe is the actual document load, which must happen exactly once
    // regardless of what this check concludes about worker availability.
    if (typeof probeRealWorker !== "function") return hasWorkerConstructor;
    if (!hasWorkerConstructor) return probeRealWorker().then(() => false).catch(() => false);

    const previousWarn = globalScope.console && globalScope.console.warn;
    let sawFakeWorkerWarning = false;
    try {
      if (globalScope.console) {
        globalScope.console.warn = (...args) => {
          if (String(args[0] || "").includes("Setting up fake worker")) {
            sawFakeWorkerWarning = true;
          }
          if (typeof previousWarn === "function") previousWarn.apply(globalScope.console, args);
        };
      }
      return probeRealWorker().then(() => !sawFakeWorkerWarning).catch(() => false);
    } finally {
      if (globalScope.console) globalScope.console.warn = previousWarn;
    }
  }

  function checkStorageAccess(propertyName) {
    try {
      const value = globalScope[propertyName];
      return Boolean(value);
    } catch {
      return false;
    }
  }

  // Determines which relevant capabilities are actually available in the current environment
  // before extraction proceeds (FR-007/FR-011/FR-012). Never throws — every underlying check is
  // wrapped so a thrown error is treated as that capability being unavailable, per FR-012's
  // conservative-default requirement. Without `probeRealWorker`, hasRealWorker reflects only
  // whether a Worker constructor exists. `probeRealWorker` is an optional injectable async
  // function that additionally watches for PDF.js's known "Setting up fake worker." console
  // warning during whatever it does, for callers with a disposable load to run it against.
  // `extractPdfText` does not use this parameter — its real, non-disposable document load
  // can't safely own that probe's error-swallowing (see loadDocumentWatchingForFakeWorker),
  // so it observes the same warning around its own load instead and folds the result in after.
  function assessCapabilities(pageCount, { probeRealWorker } = {}) {
    let hasRealWorkerResult;
    try {
      hasRealWorkerResult = checkHasRealWorker(probeRealWorker);
    } catch {
      hasRealWorkerResult = false;
    }

    const buildResult = (hasRealWorker) => ({
      hasRealWorker,
      hasLocalStorage: checkStorageAccess("localStorage"),
      hasIndexedDb: checkStorageAccess("indexedDB"),
      pageCount,
    });

    if (hasRealWorkerResult && typeof hasRealWorkerResult.then === "function") {
      return hasRealWorkerResult.catch(() => false).then(buildResult);
    }
    return buildResult(hasRealWorkerResult);
  }

  // TTSEngine contract (spec 008): any object exposing
  // `async synthesize(text, { voice, speed, endpoint }) -> { blob, synthesisMs }` satisfies it.
  // The pipeline's audio-consuming code (localChunkPromise) depends only on this shape, never on
  // Kokoro-specific request/response details — see data-model.md for the full contract. Declared
  // before the `const api = {...}`/Node-early-return boundary below (unlike most DOM-adjacent
  // code in this file) because `defaultTtsEngine` must exist for the exported getter to work
  // when this module is `require()`d under Node, which returns before the rest of the file runs.
  function createKokoroTtsEngine() {
    async function synthesize(text, options, attempt = 0) {
      try {
        const endpoints = localTtsEndpoints(options.endpoint, "speech");
        let lastResponse = null;
        for (const ttsEndpoint of endpoints) {
          const t0 = Date.now();
          lastResponse = await globalScope.fetch(ttsEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              input: text,
              voice: options.voice || "af_heart",
              response_format: "wav",
              speed: options.speed,
            }),
          });
          if (lastResponse.ok) {
            const blob = await lastResponse.blob();
            return { blob, synthesisMs: Date.now() - t0 };
          }
        }
        throw new Error("Local TTS request failed.");
      } catch (error) {
        if (attempt >= 2) throw error;
        await waitForRetryDelay(attempt);
        return synthesize(text, options, attempt + 1);
      }
    }

    return { synthesize };
  }

  let defaultTtsEngine = createKokoroTtsEngine();

  // Test-only substitution hook (spec 008, FR-011/SC-003): reassigns the module-internal engine
  // localChunkPromise reads live from this closure. A CommonJS export of `defaultTtsEngine`
  // itself would only copy the reference at require-time, not stay live — this setter is what
  // makes a test double actually reach the real playback path, not just prove callable in
  // isolation.
  function setTtsEngine(engine) {
    defaultTtsEngine = engine;
  }

  const api = {
    normalizePdfText,
    splitIntoSpeechChunks,
    renderExtractedText,
    renderSpeechFocus,
    extractPositionedItems,
    reconstructLines,
    reconstructBlocks,
    splitParagraphBoundaries,
    analyzeDocumentStats,
    buildPipelineOutput,
    classifyBlocks,
    detectColumns,
    resolveReadingOrder,
    renderNarrationText,
    mapParagraphsToChunks,
    assessCapabilities,
    assignBlockIds,
    buildDocumentAst,
    DEFAULT_SPEECH_POLICY,
    resolveSpeechPolicy,
    shouldSpeak,
    convertCardinal,
    detectNumericEntities,
    normalizeSpokenText,
    convertCodeDigits,
    convertCurrency,
    convertYear,
    convertPercentage,
    convertDecimal,
    convertOrdinal,
    findBoundaryCandidates,
    splitByTier,
    isProtectedAbbreviationPeriod,
    isProtectedDecimal,
    isProtectedCurrencyPhrase,
    isProtectedOrdinal,
    isProtectedYearPhrase,
    createKokoroTtsEngine,
    setTtsEngine,
    get defaultTtsEngine() {
      return defaultTtsEngine;
    },
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.PdfVoiceReader = api;

  if (typeof document === "undefined") return;

  const state = {
    text: "",
    chunks: [],
    chunkIndex: 0,
    audio: null,
    audioUrl: "",
    isPaused: false,
    highlightOffset: 0,
    loadId: 0,
    playbackActive: false,
    playbackId: 0,
    localAudioCache: new Map(),
    bookmarkKey: null,
    hasBookmark: false,
    paragraphChunkMap: null,
    // Spec 009, research.md Decision 2: a one-shot value, set when a bookmark with a valid
    // mid-chunk offset is restored, consumed and cleared the first time speakLocalChunk creates
    // an Audio element afterward. null at all other times.
    pendingResumeOffsetSeconds: null,
  };

  const BOOKMARK_VERSION = 1;
  const BOOKMARK_PREFIX = `pdf-reader-bookmark:v${BOOKMARK_VERSION}:`;

  const elements = {
    fileInput: document.querySelector("#fileInput"),
    dropZone: document.querySelector("#dropZone"),
    documentControls: document.querySelector("#documentControls"),
    fileName: document.querySelector("#fileName"),
    status: document.querySelector("#status"),
    statusDot: document.querySelector("#statusDot"),
    railPulse: document.querySelector("#railPulse"),
    pages: document.querySelector("#pages"),
    wordCount: document.querySelector("#wordCount"),
    textOutput: document.querySelector("#textOutput"),
    play: document.querySelector("#play"),
    pause: document.querySelector("#pause"),
    resume: document.querySelector("#resume"),
    stop: document.querySelector("#stop"),
    bookmark: document.querySelector("#bookmark"),
    localEndpoint: document.querySelector("#localEndpoint"),
    voiceField: document.querySelector("#voiceField"),
    voice: document.querySelector("#voice"),
    rate: document.querySelector("#rate"),
    rateValue: document.querySelector("#rateValue"),
    progress: document.querySelector("#progress"),
  };

  function setStatus(message) {
    elements.status.textContent = message;
  }

  function updateButtons() {
    const hasText = state.chunks.length > 0;
    const canSpeak = hasText;
    const isPlaying = state.audio && !state.isPaused;

    // Show Play only when not actively playing or paused mid-session
    elements.play.hidden = state.isPaused || isPlaying;
    elements.play.disabled = !canSpeak;

    // Pause only visible when something is actively playing
    elements.pause.hidden = !isPlaying;
    elements.pause.disabled = !isPlaying;

    // Resume only visible when paused
    elements.resume.hidden = !state.isPaused;
    elements.resume.disabled = !state.isPaused;

    elements.stop.disabled = !hasText;

    if (elements.bookmark) {
      elements.bookmark.disabled = !hasText || !state.bookmarkKey;
      elements.bookmark.textContent = state.hasBookmark ? "Remove bookmark" : `Bookmark passage ${state.chunkIndex + 1}`;
      elements.bookmark.setAttribute("aria-pressed", String(state.hasBookmark));
    }

    // Status dot reflects playback state
    if (elements.statusDot) {
      elements.statusDot.classList.toggle("is-playing", !!isPlaying);
      elements.statusDot.classList.toggle("is-paused", !!state.isPaused);
    }

    if (elements.railPulse) {
      elements.railPulse.classList.toggle("is-active", !!isPlaying || !!state.isPaused);
    }
  }

  async function bookmarkKeyForFile(file) {
    // OWASP A05:2025 Cryptographic Failures — use a one-way PDF-byte digest as a local key.
    // The key avoids persisting filenames, paths, excerpts, or document content.
    const cryptoApi = globalScope.crypto;
    if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== "function") return null;
    try {
      const bytes = await file.arrayBuffer();
      const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
      const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${BOOKMARK_PREFIX}${hex}`;
    } catch (_error) {
      return null;
    }
  }

  function bookmarkStorage() {
    try {
      return globalScope.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  // Spec 009, research.md Decision 1: `offsetSeconds` is a purely optional, additive field —
  // absent on every pre-009 record. Its presence/absence never affects whether the surrounding
  // bookmark record itself is valid (that stays governed by version/index/savedAt alone); an
  // invalid present value is simply not honored at restore time (FR-004, FR-005).
  function isValidBookmarkOffsetSeconds(value) {
    return Number.isFinite(value) && value >= 0;
  }

  function readBookmark(key, chunkCount) {
    const storage = bookmarkStorage();
    if (!key || !storage) return null;
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw);
      const isValid = value
        && value.version === BOOKMARK_VERSION
        && Number.isInteger(value.index)
        && value.index >= 0
        && value.index < chunkCount
        && Number.isFinite(value.savedAt)
        && value.savedAt > 0;
      if (!isValid) {
        storage.removeItem(key);
        return null;
      }
      return value;
    } catch (_error) {
      try { storage.removeItem(key); } catch (_removeError) { /* storage remains optional */ }
      return null;
    }
  }

  function saveBookmark() {
    const storage = bookmarkStorage();
    if (!state.bookmarkKey || !state.chunks.length || !storage
      || !Number.isInteger(state.chunkIndex) || state.chunkIndex < 0 || state.chunkIndex >= state.chunks.length) {
      setStatus("Couldn't save bookmark. Reading is still available.");
      return;
    }
    try {
      const record = {
        version: BOOKMARK_VERSION,
        index: state.chunkIndex,
        savedAt: Date.now(),
      };
      // Spec 009 FR-001/Edge Cases: only recorded when audio is actually loaded with a valid
      // position; omitted entirely otherwise, keeping the saved shape identical to a pre-009
      // bookmark for every case where there's nothing meaningful to capture.
      if (state.audio && isValidBookmarkOffsetSeconds(state.audio.currentTime)) {
        record.offsetSeconds = state.audio.currentTime;
      }
      storage.setItem(state.bookmarkKey, JSON.stringify(record));
      state.hasBookmark = true;
      updateButtons();
      setStatus(`Bookmark saved for passage ${state.chunkIndex + 1}.`);
    } catch (_error) {
      setStatus("Couldn't save bookmark. Reading is still available.");
    }
  }

  function removeBookmark() {
    const storage = bookmarkStorage();
    if (!state.bookmarkKey || !storage) {
      setStatus("Couldn't remove bookmark. Reading is still available.");
      return;
    }
    try {
      storage.removeItem(state.bookmarkKey);
      state.hasBookmark = false;
      updateButtons();
      setStatus("Bookmark removed.");
    } catch (_error) {
      setStatus("Couldn't remove bookmark. Reading is still available.");
    }
  }

  function toggleBookmark() {
    if (state.hasBookmark) removeBookmark();
    else saveBookmark();
  }

  function updateProgress() {
    if (!state.chunks.length) {
      elements.progress.value = 0;
      return;
    }
    elements.progress.value = Math.round((state.chunkIndex / state.chunks.length) * 100);
  }

  // FR-009: the reading pane MUST show literal, unmodified, original-order extracted text,
  // independent of narration cleanup/reordering (headers, footers, page numbers, citations,
  // URLs, dehyphenation, column reordering). This is the reading pane's only view.
  //
  // Paragraph numbers are rendered entirely via CSS counters (see .literal-paragraph::before
  // in styles.css) rather than measured in JS — a JS approach that measures each paragraph's
  // rendered height to place gutter numbers is fragile (layout timing, reflow-on-resize) and
  // was replaced with this simpler, always-correct approach.
  function renderLiteralTextWithLineNumbers(container, text, activeIndex = -1) {
    const doc = container.ownerDocument;
    if (!doc || typeof container.replaceChildren !== "function") {
      renderExtractedText(container, text);
      return;
    }

    const paragraphs = String(text || "").split(/\n\n/).filter((paragraph) => paragraph.length > 0);
    if (!paragraphs.length) {
      renderExtractedText(container, text);
      return;
    }

    if (!state.paragraphChunkMap || state.paragraphChunkMap.length !== paragraphs.length) {
      state.paragraphChunkMap = mapParagraphsToChunks(paragraphs, state.chunks);
    }

    let activeBlock = null;
    const paragraphBlocks = paragraphs.map((paragraph, index) => {
      const block = doc.createElement("button");
      block.type = "button";
      block.className = "literal-paragraph";
      block.textContent = paragraph;
      const chunkIndex = state.paragraphChunkMap[index];
      if (chunkIndex !== null && chunkIndex !== undefined) {
        block.setAttribute("data-chunk-index", String(chunkIndex));
        block.setAttribute("aria-label", "Start reading near this passage");
        if (chunkIndex === activeIndex) {
          block.className = "literal-paragraph is-active";
          if (typeof block.setAttribute === "function") block.setAttribute("aria-current", "true");
          activeBlock = block;
        }
      } else if (typeof block.setAttribute === "function") {
        block.setAttribute("disabled", "true");
      }
      return block;
    });

    container.replaceChildren(...paragraphBlocks);
    if (activeBlock && typeof activeBlock.scrollIntoView === "function") {
      const reduceMotion = globalScope.matchMedia
        && globalScope.matchMedia("(prefers-reduced-motion: reduce)").matches;
      activeBlock.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }
  }

  function renderPlaybackText(activeIndex = -1) {
    renderLiteralTextWithLineNumbers(elements.textOutput, state.text, activeIndex);
  }

  function clearDocumentState(message = "Choose a PDF to begin.") {
    state.text = "";
    state.chunks = [];
    state.chunkIndex = 0;
    state.audio = null;
    state.isPaused = false;
    state.highlightOffset = 0;
    state.playbackActive = false;
    state.playbackId += 1;
    state.bookmarkKey = null;
    state.hasBookmark = false;
    state.paragraphChunkMap = null;
    state.localAudioCache.clear();
    ewma.reset();
    elements.fileName.textContent = "No file selected";
    elements.pages.textContent = "0";
    elements.wordCount.textContent = "0";
    elements.documentControls.hidden = true;
    renderExtractedText(elements.textOutput, "Choose a PDF to preview extracted text.");
    setStatus(message);
    updateProgress();
    updateButtons();
  }

  function stopSpeech() {
    if (state.audio) {
      state.audio.pause();
      state.audio.currentTime = 0;
      state.audio = null;
    }
    if (state.audioUrl) {
      globalScope.URL.revokeObjectURL(state.audioUrl);
      state.audioUrl = "";
    }
  }

  function clearLocalAudioCache(beforeIndex = 0) {
    for (const [index, entry] of state.localAudioCache.entries()) {
      if (index < beforeIndex) {
        if (entry && typeof entry.catch === "function") entry.catch(() => {});
        state.localAudioCache.delete(index);
      }
    }
  }

  function failPlayback(message) {
    stopSpeech();
    state.audio = null;
    state.isPaused = false;
    state.highlightOffset = 0;
    state.playbackActive = false;
    state.playbackId += 1;
    if (state.text) renderPlaybackText();
    setStatus(message);
    updateButtons();
  }

  function isLocalTtsEndpoint(value) {
    if (typeof value === "string" && value.startsWith("/v1/audio/speech")) {
      return true;
    }
    try {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:")
        && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    } catch {
      return false;
    }
  }

  function localVoicesEndpoint(value) {
    return localTtsEndpoints(value, "voices")[0];
  }

  function localTtsEndpoints(value, mode = "speech") {
    const path = mode === "voices" ? "/v1/audio/voices" : "/v1/audio/speech";
    const raw = typeof value === "string" ? value.trim() : "";
    const endpoints = [];
    const add = (candidate) => {
      if (candidate && !endpoints.includes(candidate)) endpoints.push(candidate);
    };

    if (raw.startsWith("/v1/audio/speech")) {
      add(path);
      if (typeof globalScope.location?.origin === "string") {
        add(new URL(path, globalScope.location.origin).toString());
      }
      add(`http://localhost:8880${path}`);
      add(`http://127.0.0.1:8880${path}`);
      return endpoints;
    }

    try {
      const url = new URL(raw);
      if (mode === "voices") {
        url.pathname = url.pathname.replace(/\/speech\/?$/, "/voices");
      }
      add(url.toString());
    } catch {
      add(path);
    }

    if (endpoints.length && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(endpoints[0])) {
      add(`http://localhost:8880${path}`);
      add(`http://127.0.0.1:8880${path}`);
    }

    return endpoints;
  }

  // --- Persistent LRU audio cache (IndexedDB) ---
  const ttsCache = (() => {
    const DB_NAME = "tts-audio-cache";
    const STORE = "entries";
    const DB_VERSION = 1;
    const MAX_BYTES = 150 * 1024 * 1024; // 150 MB

    let _db = null;

    function openDb() {
      if (_db) return Promise.resolve(_db);
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: "key" });
            store.createIndex("lastUsed", "lastUsed");
          }
        };
        req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
        req.onerror = () => reject(req.error);
      });
    }

    async function sha256Key(text, voice, speed) {
      const raw = `${voice}|${speed}|${text}`;
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    async function get(key) {
      const db = await openDb();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, "readwrite");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => {
          const entry = req.result;
          if (!entry) { resolve(null); return; }
          // Update lastUsed in the same transaction
          entry.lastUsed = Date.now();
          tx.objectStore(STORE).put(entry);
          resolve(entry.blob);
        };
        req.onerror = () => resolve(null);
      });
    }

    async function put(key, blob) {
      const db = await openDb();
      const entry = { key, blob, size: blob.size, lastUsed: Date.now() };
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(entry);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      evict().catch(() => {});
    }

    async function evict() {
      const db = await openDb();
      // Gather all entries sorted oldest-first by lastUsed
      const all = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).index("lastUsed").getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      let total = all.reduce((sum, e) => sum + (e.size || 0), 0);
      if (total <= MAX_BYTES) return;
      const toDelete = [];
      for (const entry of all) {
        if (total <= MAX_BYTES) break;
        toDelete.push(entry.key);
        total -= entry.size || 0;
      }
      if (!toDelete.length) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        toDelete.forEach((k) => tx.objectStore(STORE).delete(k));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }

    return { sha256Key, get, put };
  })();
  // --- end persistent cache ---

  // --- EWMA response-time estimator (Algorithm 2) ---
  const ewma = (() => {
    // α_fast tracks short-term spikes; α_slow tracks steady-state trend
    const ALPHA_FAST = 0.3;
    const ALPHA_SLOW = 0.05;
    const SAFETY = 0.9;          // conservative bias — prefer fewer prefetches over stalls
    const MIN_AHEAD = 1;         // always prefetch at least 1 chunk ahead
    const MAX_AHEAD = 6;         // cap to avoid memory bloat
    const CHUNK_PLAY_MS = 2500;  // approximate playback duration per chunk (ms)

    let fast = null;
    let slow = null;

    function record(responseMs) {
      if (fast === null) { fast = responseMs; slow = responseMs; return; }
      fast = ALPHA_FAST * responseMs + (1 - ALPHA_FAST) * fast;
      slow = ALPHA_SLOW * responseMs + (1 - ALPHA_SLOW) * slow;
    }

    function lookahead() {
      if (fast === null) return MIN_AHEAD;
      // Conservative estimate: use the slower (higher) of the two windows
      const estimatedMs = Math.max(fast, slow) / SAFETY;
      // How many chunks can Kokoro synthesise in one chunk's play window?
      const ahead = Math.floor(CHUNK_PLAY_MS / estimatedMs);
      return Math.min(Math.max(ahead, MIN_AHEAD), MAX_AHEAD);
    }

    function reset() { fast = null; slow = null; }

    return { record, lookahead, reset };
  })();
  // --- end EWMA ---

  async function waitForRetryDelay(attempt) {
    return new Promise((resolve) => {
      globalScope.setTimeout(resolve, Math.min(750, 150 * (attempt + 1)));
    });
  }

  function localChunkPromise(index) {
    if (index < 0 || index >= state.chunks.length) return Promise.resolve(null);
    if (state.localAudioCache.has(index)) return state.localAudioCache.get(index);

    const endpoint = elements.localEndpoint.value.trim();
    const chunkText = state.chunks[index];
    const voice = elements.voice.value.trim() || "af_heart";
    const speed = Number(elements.rate.value);

    const promise = ttsCache.sha256Key(chunkText, voice, speed).then(async (cacheKey) => {
      const cached = await ttsCache.get(cacheKey);
      if (cached) return cached;

      const result = await defaultTtsEngine.synthesize(chunkText, { voice, speed, endpoint });
      if (result.synthesisMs !== undefined) ewma.record(result.synthesisMs);
      ttsCache.put(cacheKey, result.blob).catch(() => {});
      return result.blob;
    });

    state.localAudioCache.set(index, promise);
    return promise;
  }

  function prefetchLocalAudio(index) {
    if (index < 0 || index >= state.chunks.length) return Promise.resolve(null);
    const promise = localChunkPromise(index);
    promise.catch(() => {});
    return promise;
  }

  function prefetchAhead(fromIndex) {
    const ahead = ewma.lookahead();
    for (let i = 1; i <= ahead; i += 1) {
      prefetchLocalAudio(fromIndex + i);
    }
  }

  async function loadLocalVoices() {
    const endpoint = elements.localEndpoint.value.trim();
    if (!isLocalTtsEndpoint(endpoint)) {
      setStatus("Local TTS must use localhost or 127.0.0.1.");
      return;
    }

    try {
      const endpoints = localTtsEndpoints(endpoint, "voices");
      let response = null;
      for (const voiceEndpoint of endpoints) {
        response = await globalScope.fetch(voiceEndpoint);
        if (response.ok) break;
      }
      if (!response || !response.ok) throw new Error("Local voices unavailable.");
      const data = await response.json();
      const rawVoices = Array.isArray(data.voices) ? data.voices : [];
      // Accept either a plain string id or an { id, name } object, since Kokoro-compatible
      // servers are not consistent about which shape they return.
      const voices = rawVoices
        .map((voice) => (typeof voice === "string" ? voice : voice?.id))
        .filter((voice) => typeof voice === "string" && voice);
      if (!voices.length) throw new Error("Local voices unavailable.");
      const preferred = voices.includes("af_heart") ? "af_heart" : voices[0];
      elements.voice.replaceChildren(...voices.map((voice) => {
        const option = document.createElement("option");
        option.value = voice;
        option.textContent = voice;
        option.selected = voice === preferred;
        return option;
      }));
      elements.voice.value = preferred;
    } catch {
      const option = document.createElement("option");
      option.value = "af_heart";
      option.textContent = "af_heart";
      option.selected = true;
      elements.voice.replaceChildren(option);
      elements.voice.value = "af_heart";
      setStatus("Local Kokoro voices unavailable.");
    }
  }

  async function initializeVoices() {
    await loadLocalVoices();
    if (state.chunks.length && isLocalTtsEndpoint(elements.localEndpoint.value.trim())) {
      prefetchLocalAudio(state.chunkIndex);
      prefetchAhead(state.chunkIndex);
    }
    updateButtons();
  }

  async function loadPdfEngine() {
    if (!globalScope.pdfjsLib) {
      await import("./pdf-engine.js");
    }
    if (!globalScope.pdfjsLib) {
      throw new Error("PDF engine failed to load. Run the app from the local server and reload.");
    }
    return globalScope.pdfjsLib;
  }

  function pageColumnLayout(blocks) {
    return blocks.some((block) => block.column !== undefined) ? "two-column" : "single";
  }

  // Yields to a real macrotask (not just a microtask/Promise queue) so the browser can repaint
  // and respond to input mid-processing — a plain `await Promise.resolve()` would not achieve
  // this, since it never leaves the current turn of the event loop.
  function yieldToMainThread() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function buildPipelineOutput(pagesOfItems, pageWidth, pageHeight, policy) {
    const resolvedPolicy = resolveSpeechPolicy(policy);
    const displayPages = pagesOfItems.map((items) => items.map((item) => item.str).join(" "));
    const displayText = normalizePdfText(displayPages.join("\n\n"));

    // UI-freeze fix: reconstructing blocks for every page in one uninterrupted synchronous pass
    // is what made processing a large document freeze the tab. A plain `.map()` can't yield
    // between iterations, so this is a `for` loop with an explicit macrotask yield after each
    // page (matching the same per-page granularity already used during PDF text extraction).
    const rawBlocksByPageUnindexed = [];
    for (let pageIndex = 0; pageIndex < pagesOfItems.length; pageIndex += 1) {
      const positioned = extractPositionedItems(pagesOfItems[pageIndex], pageIndex, pageWidth, pageHeight);
      const lines = reconstructLines(positioned);
      rawBlocksByPageUnindexed.push(splitParagraphBoundaries(reconstructBlocks(lines)));
      if (pageIndex < pagesOfItems.length - 1) await yieldToMainThread();
    }
    const rawBlocksByPage = assignBlockIds(rawBlocksByPageUnindexed);

    const stats = analyzeDocumentStats(rawBlocksByPage);
    const classifiedBlocksByPage = classifyBlocks(rawBlocksByPage, stats);
    const columnedBlocksByPage = detectColumns(classifiedBlocksByPage);
    const columnLayoutByPage = columnedBlocksByPage.map(pageColumnLayout);
    const orderedBlocksByPage = resolveReadingOrder(columnedBlocksByPage, columnLayoutByPage);
    const narrationText = renderNarrationText(orderedBlocksByPage, resolvedPolicy);
    const document = buildDocumentAst(orderedBlocksByPage, resolvedPolicy);

    return { displayText, narrationText, document };
  }

  // Watches for PDF.js's fake-worker console warning during `loadDocument`, without owning or
  // altering `loadDocument`'s own resolution/rejection (FR-010) — `checkHasRealWorker`'s
  // `probeRealWorker` path can't be reused here since it calls the probe and interprets its
  // outcome together, and a real document load's own errors must propagate untouched (see the
  // regression this avoided, recorded in tasks.md T022). The vendored PDF.js build only emits
  // this warning once per page lifetime (a private static flag on PDFWorker suppresses repeats),
  // so this has to observe the actual first load rather than a later, separate probe call.
  async function loadDocumentWatchingForFakeWorker(loadDocument) {
    const previousWarn = globalScope.console && globalScope.console.warn;
    let sawFakeWorkerWarning = false;
    if (globalScope.console) {
      globalScope.console.warn = (...args) => {
        if (String(args[0] || "").includes("Setting up fake worker")) {
          sawFakeWorkerWarning = true;
        }
        if (typeof previousWarn === "function") previousWarn.apply(globalScope.console, args);
      };
    }
    try {
      const pdf = await loadDocument();
      return { pdf, sawFakeWorkerWarning };
    } finally {
      if (globalScope.console) globalScope.console.warn = previousWarn;
    }
  }

  async function extractPdfText(file) {
    const pdfjsLib = await loadPdfEngine();
    const buffer = await file.arrayBuffer();

    const { pdf, sawFakeWorkerWarning } = await loadDocumentWatchingForFakeWorker(
      () => pdfjsLib.getDocument({ data: buffer }).promise,
    );
    const capabilities = await assessCapabilities(pdf.numPages);
    if (sawFakeWorkerWarning) capabilities.hasRealWorker = false;

    if (pdf.numPages > LARGE_DOCUMENT_PAGE_THRESHOLD && !capabilities.hasRealWorker) {
      throw new Error(
        "This document is too large to process reliably without a background worker in this browser.",
      );
    }

    const pagesOfItems = [];
    let pageWidth = 0;
    let pageHeight = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const viewport = typeof page.getViewport === "function" ? page.getViewport({ scale: 1 }) : null;
      pageWidth = viewport?.width || pageWidth || 1;
      pageHeight = viewport?.height || pageHeight || 1;
      pagesOfItems.push(content.items);
      setStatus(`Reading page ${pageNumber} of ${pdf.numPages}...`);
    }

    const { displayText, narrationText } = await buildPipelineOutput(pagesOfItems, pageWidth, pageHeight);

    return {
      pageCount: pdf.numPages,
      text: displayText,
      narrationText,
    };
  }

  async function loadEpubEngine() {
    if (!globalScope.fflate) {
      await import("./epub-engine.js");
    }
    if (!globalScope.fflate) {
      throw new Error("EPUB engine failed to load. Run the app from the local server and reload.");
    }
    return globalScope.fflate;
  }

  // OWASP A08:2025 Mishandling of Exceptional Conditions - bound zip bomb inputs
  // so a crafted EPUB cannot exhaust memory during decompression.
  const EPUB_MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MB
  const EPUB_MAX_ENTRIES = 10000;

  function decodeUtf8(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  function resolveEpubPath(baseDir, href) {
    const clean = String(href || "").split("#")[0];
    const segments = [...baseDir.split("/"), ...clean.split("/")].filter((segment) => segment && segment !== ".");
    const resolved = [];
    for (const segment of segments) {
      if (segment === "..") resolved.pop();
      else resolved.push(segment);
    }
    return resolved.join("/");
  }

  function xhtmlToText(markup) {
    const parser = new globalScope.DOMParser();
    const doc = parser.parseFromString(markup, "application/xhtml+xml");
    const body = doc.body || doc.documentElement;
    if (!body) return "";
    if (typeof body.querySelectorAll === "function") {
      body.querySelectorAll("script, style").forEach((node) => node.remove());
    }
    return body.textContent || "";
  }

  async function extractEpubText(file) {
    const fflate = await loadEpubEngine();
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    let entries;
    try {
      entries = fflate.unzipSync(bytes);
    } catch (_error) {
      throw new Error("Could not read this EPUB. The file may be corrupt.");
    }

    const paths = Object.keys(entries);
    if (paths.length > EPUB_MAX_ENTRIES) {
      throw new Error("This EPUB has too many files to read safely.");
    }
    const totalBytes = paths.reduce((sum, path) => sum + entries[path].length, 0);
    if (totalBytes > EPUB_MAX_UNCOMPRESSED_BYTES) {
      throw new Error("This EPUB is too large to read safely.");
    }

    const containerXml = entries["META-INF/container.xml"];
    if (!containerXml) {
      throw new Error("Could not read this EPUB. Missing container.xml.");
    }
    const containerMatch = decodeUtf8(containerXml).match(/full-path="([^"]+)"/);
    const opfPath = containerMatch && containerMatch[1];
    const opfBytes = opfPath && entries[opfPath];
    if (!opfBytes) {
      throw new Error("Could not read this EPUB. Missing content manifest.");
    }

    const opfText = decodeUtf8(opfBytes);
    const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";

    const manifest = new Map();
    const itemPattern = /<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"[^>]*\/?>|<item\b[^>]*\bhref="([^"]+)"[^>]*\bid="([^"]+)"[^>]*\/?>/g;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(opfText))) {
      const id = itemMatch[1] || itemMatch[4];
      const href = itemMatch[2] || itemMatch[3];
      manifest.set(id, href);
    }

    const spine = [];
    const spinePattern = /<itemref\b[^>]*\bidref="([^"]+)"[^>]*\/?>/g;
    let spineMatch;
    while ((spineMatch = spinePattern.exec(opfText))) {
      const href = manifest.get(spineMatch[1]);
      if (href) spine.push(resolveEpubPath(opfDir, href));
    }

    if (!spine.length) {
      throw new Error("Could not read this EPUB. No readable chapters listed.");
    }

    const chapters = [];
    for (const path of spine) {
      const chapterBytes = entries[path];
      if (!chapterBytes) continue;
      chapters.push(xhtmlToText(decodeUtf8(chapterBytes)));
    }

    return {
      pageCount: chapters.length,
      text: normalizePdfText(chapters.join("\n\n")),
    };
  }

  function isEpubFile(file) {
    return file.type === "application/epub+zip" || file.name.toLowerCase().endsWith(".epub");
  }

  function isPdfFile(file) {
    return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  }

  async function handleFile(file) {
    if (!file) return;
    if (!isPdfFile(file) && !isEpubFile(file)) {
      state.loadId += 1;
      clearDocumentState("Choose a PDF or EPUB file.");
      return;
    }

    const loadId = state.loadId + 1;
    state.loadId = loadId;
    const isEpub = isEpubFile(file);
    stopReading();
    setStatus(isEpub ? "Loading EPUB..." : "Loading PDF...");
    elements.fileName.textContent = file.name;
    elements.documentControls.hidden = true;
    elements.play.disabled = true;

    try {
      const result = isEpub ? await extractEpubText(file) : await extractPdfText(file);
      if (loadId !== state.loadId) return;
      state.text = result.text;
      state.chunks = splitIntoSpeechChunks(result.narrationText || result.text);
      state.paragraphChunkMap = null;
      state.chunkIndex = 0;
      state.highlightOffset = 0;
      state.localAudioCache.clear();
      state.bookmarkKey = null;
      state.hasBookmark = false;
      state.pendingResumeOffsetSeconds = null;

      if (state.chunks.length) {
        const bookmarkKey = await bookmarkKeyForFile(file);
        if (loadId !== state.loadId) return;
        state.bookmarkKey = bookmarkKey;
        const bookmark = readBookmark(bookmarkKey, state.chunks.length);
        if (bookmark) {
          state.chunkIndex = bookmark.index;
          state.hasBookmark = true;
          if (isValidBookmarkOffsetSeconds(bookmark.offsetSeconds)) {
            state.pendingResumeOffsetSeconds = bookmark.offsetSeconds;
          }
        }
      }

      const noTextPaneMessage = isEpub
        ? "No readable text found in this EPUB."
        : "No readable text found. This PDF may be a scan. Try a text-based PDF or run OCR first.";
      const noTextStatusMessage = isEpub
        ? "No readable text found in this EPUB."
        : "No readable text found. Try a text-based PDF or run OCR first.";
      if (state.chunks.length) {
        renderPlaybackText(state.hasBookmark ? state.chunkIndex : -1);
      } else {
        renderExtractedText(elements.textOutput, noTextPaneMessage);
      }
      elements.documentControls.hidden = !state.chunks.length;
      elements.pages.textContent = String(result.pageCount);
      elements.wordCount.textContent = String(result.text ? result.text.split(/\s+/).filter(Boolean).length : 0);
      setStatus(
        state.chunks.length && state.hasBookmark
          ? `Bookmark restored at passage ${state.chunkIndex + 1}. Press Play to continue.`
          : state.chunks.length
          ? "Ready. Press Play, or select a passage to start there."
          : noTextStatusMessage,
      );
      if (state.chunks.length && isLocalTtsEndpoint(elements.localEndpoint.value.trim())) {
        prefetchLocalAudio(state.chunkIndex);
        prefetchAhead(state.chunkIndex);
      }
      updateProgress();
      updateButtons();
    } catch (error) {
      if (loadId !== state.loadId) return;
      clearDocumentState(error.message || (isEpub ? "Could not read this EPUB." : "Could not read this PDF."));
    }
  }

  async function speakLocalChunk() {
    const playbackIndex = state.chunkIndex;
    const playbackSession = state.playbackId;

    if (state.chunkIndex >= state.chunks.length) {
      stopReading(false);
      setStatus("Finished.");
      elements.progress.value = 100;
      return;
    }

    const endpoint = elements.localEndpoint.value.trim();
    if (!isLocalTtsEndpoint(endpoint)) {
      failPlayback("Local TTS must use localhost or 127.0.0.1.");
      return;
    }

    renderPlaybackText(state.chunkIndex);
    setStatus(`Reading ${state.chunkIndex + 1} of ${state.chunks.length}...`);
    updateButtons();

    try {
      const currentChunk = localChunkPromise(playbackIndex);
      prefetchAhead(playbackIndex);
      const blob = await currentChunk;
      if (playbackSession !== state.playbackId || playbackIndex !== state.chunkIndex || !blob) {
        return;
      }
      clearLocalAudioCache(playbackIndex - 1);
      if (state.audioUrl) globalScope.URL.revokeObjectURL(state.audioUrl);
      state.audioUrl = globalScope.URL.createObjectURL(blob);
      state.audio = new globalScope.Audio(state.audioUrl);
      // Spec 009, research.md Decisions 2/3: apply the one-shot pending resume offset, then
      // unconditionally clear it — every later call to speakLocalChunk in this session (chunk
      // advance, reconnect) finds it already null and behaves exactly as before this feature.
      // An out-of-range value is left to the platform's own currentTime clamping (FR-005); no
      // duration pre-check is performed.
      if (state.pendingResumeOffsetSeconds !== null) {
        state.audio.currentTime = state.pendingResumeOffsetSeconds;
        state.pendingResumeOffsetSeconds = null;
      }
      state.audio.onended = () => {
        if (playbackSession !== state.playbackId) return;
        state.audio = null;
        state.chunkIndex += 1;
        updateProgress();
        clearLocalAudioCache(state.chunkIndex - 1);
        speakLocalChunk();
      };
      state.audio.onerror = () => {
        if (playbackSession !== state.playbackId) return;
        if (state.playbackActive) {
          state.audio = null;
          state.isPaused = false;
          setStatus("Reconnecting local TTS...");
          speakLocalChunk();
          return;
        }
        failPlayback("Local TTS playback stopped.");
      };
      state.playbackActive = true;
      await state.audio.play();
      updateButtons();
    } catch (error) {
      failPlayback(error.message || "Local TTS request failed.");
    }
  }

  async function playReading() {
    if (!state.chunks.length) return;
    stopSpeech();
    state.playbackId += 1;
    state.playbackActive = true;
    await speakLocalChunk();
  }

  function pauseReading() {
    if (!state.audio) return;
    state.isPaused = true;
    state.audio.pause();
    setStatus("Paused.");
    updateButtons();
  }

  function resumeReading() {
    if (!state.isPaused) return;
    state.isPaused = false;
    state.audio.play();
    setStatus("Reading resumed.");
    updateButtons();
  }

  function stopReading(resetProgress = true) {
    stopSpeech();
    state.audio = null;
    state.isPaused = false;
    state.playbackActive = false;
    state.playbackId += 1;
    if (resetProgress) state.chunkIndex = 0;
    state.highlightOffset = 0;
    state.localAudioCache.clear();
    ewma.reset();
    if (state.text) renderPlaybackText();
    updateProgress();
    updateButtons();
  }

  elements.fileInput.addEventListener("change", async (event) => handleFile(event.target.files[0]));
  elements.play.addEventListener("click", playReading);
  elements.pause.addEventListener("click", pauseReading);
  elements.resume.addEventListener("click", resumeReading);
  elements.localEndpoint.addEventListener("change", () => {
    loadLocalVoices();
  });
  elements.stop.addEventListener("click", () => {
    stopReading();
    setStatus(state.chunks.length ? "Stopped." : "Choose a PDF to begin.");
  });
  if (elements.bookmark) elements.bookmark.addEventListener("click", toggleBookmark);

  elements.rate.addEventListener("input", () => {
    elements.rateValue.textContent = `${Number(elements.rate.value).toFixed(1)}x`;
  });

  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
  elements.dropZone.addEventListener("dragleave", () => {
    elements.dropZone.classList.remove("is-dragging");
  });
  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
    handleFile(event.dataTransfer.files[0]);
  });
  elements.textOutput.addEventListener("click", (event) => {
    const target = typeof event.target?.closest === "function"
      ? event.target.closest("[data-chunk-index]")
      : null;
    if (!target || !state.chunks.length) return;

    const index = Number(target.getAttribute("data-chunk-index"));
    if (!Number.isInteger(index) || index < 0 || index >= state.chunks.length) return;

    state.chunkIndex = index;
    state.highlightOffset = 0;
    updateProgress();

    stopSpeech();
    state.playbackId += 1;
    state.playbackActive = true;
    state.isPaused = false;
    speakLocalChunk();
  });

  initializeVoices();
  updateButtons();
})(typeof window !== "undefined" ? window : globalThis);
