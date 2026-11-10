package nl.timvanbergen.skitta

import android.content.Context
import android.net.Uri
import android.os.Build
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.webkit.WebView
import androidx.core.view.inputmethod.EditorInfoCompat
import androidx.core.view.inputmethod.InputConnectionCompat

/**
 * WebView die afbeeldingen van het toetsenbord aanneemt (Samsung-toetsenbord, Gboard: klembord, GIF's,
 * stickers). De gewone WebView kan dat niet; hier vangen we het op en geven het door aan de pagina.
 */
class SkittaWebView(context: Context, private val onContent: (Uri, String) -> Unit) : WebView(context) {

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val ic = super.onCreateInputConnection(outAttrs) ?: return null
        EditorInfoCompat.setContentMimeTypes(outAttrs, arrayOf("image/*", "image/png", "image/jpeg", "image/gif", "image/webp", "video/*"))
        return InputConnectionCompat.createWrapper(ic, outAttrs) { info, flags, _ ->
            if (Build.VERSION.SDK_INT >= 25 && (flags and InputConnectionCompat.INPUT_CONTENT_GRANT_READ_URI_PERMISSION) != 0) {
                runCatching { info.requestPermission() }
            }
            val mime = info.description.getMimeType(0) ?: "image/png"
            onContent(info.contentUri, mime)
            runCatching { info.releasePermission() }
            true
        }
    }
}
