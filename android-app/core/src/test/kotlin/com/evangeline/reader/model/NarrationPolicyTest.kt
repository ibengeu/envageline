package com.evangeline.reader.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NarrationPolicyTest {
    @Test
    fun `every block type has an explicit narration decision`() {
        val undecided = DocumentBlockType.entries.filterNot { NARRATION_POLICY.containsKey(it) }

        assertTrue(
            undecided.isEmpty(),
            "block types with no narration policy would default to spoken: $undecided",
        )
    }

    @Test
    fun `page furniture is not spoken`() {
        val furniture = listOf(
            DocumentBlockType.HEADER,
            DocumentBlockType.FOOTER,
            DocumentBlockType.PAGE_NUMBER,
        )

        furniture.forEach { type ->
            assertEquals(NarrationPolicy.SKIP, NARRATION_POLICY[type], "$type should be skipped")
        }
    }
}
