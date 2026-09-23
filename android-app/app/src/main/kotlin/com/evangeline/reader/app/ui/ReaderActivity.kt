package com.evangeline.reader.app.ui

import android.app.Activity
import android.os.Bundle
import android.graphics.Color
import android.view.Gravity
import android.widget.TextView
import com.evangeline.reader.app.R

/**
 * The launcher. A placeholder shell: the document picker, page surface,
 * highlight overlay and controls arrive with User Story 1 (T054-T058).
 */
private const val TEXT_SIZE_SP = 18f
private const val PADDING_PX = 48

class ReaderActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(
            TextView(this).apply {
                text = getString(R.string.app_shell_placeholder)
                textSize = TEXT_SIZE_SP
                gravity = Gravity.CENTER
                setTextColor(Color.BLACK)
                setPadding(PADDING_PX, PADDING_PX, PADDING_PX, PADDING_PX)
            },
        )
    }
}
