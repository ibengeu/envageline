package com.evangeline.reader.narration

import com.evangeline.reader.model.BoundingBox
import com.evangeline.reader.model.DocumentBlock
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** One positioned run of text as reported by the PDF text layer. */
data class TextItem(
    val text: String,
    val transform: List<Double>,
    val width: Double? = null,
    val height: Double? = null,
    val fontName: String? = null,
)

/** Ascent and descent in em fractions, as the PDF font metrics report them. */
data class FontStyle(val ascent: Double?, val descent: Double?)

/** An affine matrix in PDF order: a, b, c, d, e, f. */
private typealias Matrix = List<Double>

private data class Point(val x: Double, val y: Double)

/** The PDF origin is bottom-left with y rising; the page is read top-down. */
private fun defaultViewport(pageHeight: Double): Matrix =
    listOf(1.0, 0.0, 0.0, -1.0, 0.0, pageHeight)

private fun multiply(left: Matrix, right: Matrix): Matrix = listOf(
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
)

private fun apply(matrix: Matrix, x: Double, y: Double): Point =
    Point(matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5])

private fun unitVector(x: Double, y: Double): Point {
    val length = hypot(x, y)
    return if (!length.isFinite() || length == 0.0) Point(0.0, 0.0) else Point(x / length, y / length)
}

private fun Point.offsetBy(unit: Point, distance: Double): Point =
    Point(x + unit.x * distance, y + unit.y * distance)

/** How far glyphs rise above and drop below the baseline, in page units. */
private data class GlyphExtent(val rise: Double, val drop: Double)

/**
 * OWASP A10:2025 Mishandling of Exceptional Conditions - a font without usable
 * metrics keeps the em box rather than collapsing to an empty rectangle.
 */
private fun glyphExtent(style: FontStyle?, fontSize: Double, fallbackHeight: Double): GlyphExtent {
    val ascent = style?.ascent
    val descent = style?.descent
    val usable = ascent != null && descent != null &&
        ascent.isFinite() && descent.isFinite() && ascent > 0 && fontSize > 0
    if (!usable) return GlyphExtent(rise = fallbackHeight, drop = 0.0)
    return GlyphExtent(rise = ascent * fontSize, drop = abs(descent) * fontSize)
}

private fun clamp01(value: Double): Double =
    if (value.isNaN()) 0.0 else min(1.0, max(0.0, value))

/**
 * OWASP A02:2025 Security Misconfiguration - reject non-finite transforms and
 * page sizes before they can produce geometry the overlay cannot draw.
 *
 * Defence in depth: every input rejected here is also rejected by
 * [normalisedBounds], which is what the tests pin. This guard keeps the
 * rejection explicit and near the untrusted input, so a later change to the
 * corner math cannot let a degenerate transform through unnoticed.
 */
private fun isUsable(
    item: Matrix,
    viewport: Matrix,
    width: Double,
    extent: GlyphExtent,
    pageWidth: Double,
    pageHeight: Double,
): Boolean =
    pageWidth.isFinite() && pageHeight.isFinite() && pageWidth > 0 && pageHeight > 0 &&
        width.isFinite() && width > 0 &&
        extent.rise.isFinite() && extent.drop.isFinite() && extent.rise + extent.drop > 0 &&
        (item + viewport).all { it.isFinite() }

/**
 * The glyph box is built from the item origin and the viewport scale only.
 * Pushing the size through the combined matrix would re-apply the font scale.
 */
private fun glyphCorners(
    combined: Matrix,
    viewport: Matrix,
    width: Double,
    extent: GlyphExtent,
): List<Point> {
    val origin = apply(combined, 0.0, 0.0)
    val scaleX = hypot(viewport[0], viewport[1])
    val scaleY = hypot(viewport[2], viewport[3])
    val spanX = apply(combined, 1.0, 0.0)
    val spanY = apply(combined, 0.0, 1.0)
    val unitX = unitVector(spanX.x - origin.x, spanX.y - origin.y)
    val unitY = unitVector(spanY.x - origin.x, spanY.y - origin.y)
    val deviceWidth = width * scaleX
    val ascentPoint = origin.offsetBy(unitY, extent.rise * scaleY)
    val descentPoint = origin.offsetBy(unitY, -extent.drop * scaleY)
    return listOf(
        descentPoint,
        descentPoint.offsetBy(unitX, deviceWidth),
        ascentPoint.offsetBy(unitX, deviceWidth),
        ascentPoint,
    )
}

/** Clips each edge to the page, so an item running off it keeps the visible part. */
private fun normalisedBounds(
    corners: List<Point>,
    pageWidth: Double,
    pageHeight: Double,
): BoundingBox? {
    val left = clamp01(corners.minOf { it.x } / pageWidth)
    val top = clamp01(corners.minOf { it.y } / pageHeight)
    val right = clamp01(corners.maxOf { it.x } / pageWidth)
    val bottom = clamp01(corners.maxOf { it.y } / pageHeight)
    if (right <= left || bottom <= top) return null
    return BoundingBox(x = left, y = top, width = right - left, height = bottom - top)
}

private fun itemBounds(
    item: TextItem,
    viewport: Matrix,
    styles: Map<String, FontStyle>,
    pageWidth: Double,
    pageHeight: Double,
): BoundingBox? {
    val matrix = item.transform
    if (matrix.size < 6) return null
    val horizontalScale = hypot(matrix[0], matrix[1])
    val verticalScale = hypot(matrix[2], matrix[3])
    val width = item.width ?: (horizontalScale * item.text.length * 0.5)
    val height = item.height ?: verticalScale.takeIf { it != 0.0 } ?: horizontalScale
    val fontSize = verticalScale.takeIf { it != 0.0 } ?: horizontalScale.takeIf { it != 0.0 } ?: height
    val extent = glyphExtent(styles[item.fontName], fontSize, height)
    if (!isUsable(matrix, viewport, width, extent, pageWidth, pageHeight)) return null
    val corners = glyphCorners(multiply(viewport, matrix), viewport, width, extent)
    return normalisedBounds(corners, pageWidth, pageHeight)
}

/**
 * Turns positioned text runs into blocks whose bounds are normalised to 0..1,
 * so geometry is independent of render scale and device density.
 */
fun itemsToBlocks(
    pageNumber: Int,
    items: List<TextItem>,
    pageWidth: Double,
    pageHeight: Double,
    styles: Map<String, FontStyle> = emptyMap(),
    viewportTransform: List<Double> = defaultViewport(pageHeight),
): List<DocumentBlock> {
    val blocks = mutableListOf<DocumentBlock>()
    for (item in items) {
        val text = item.text.replace(' ', ' ')
        if (text.isBlank()) continue
        val bounds = itemBounds(item, viewportTransform, styles, pageWidth, pageHeight) ?: continue
        blocks += DocumentBlock(
            id = "p$pageNumber-b${blocks.size}",
            page = pageNumber,
            text = text,
            bounds = bounds,
            fontSize = null,
            fontName = item.fontName,
        )
    }
    return blocks
}
