package nl.timvanbergen.belliechat

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File

/**
 * Skitta Lite als Android-app: de webapp van skittalite.timvanbergen.nl (public/lite/) in een WebView, zodat elke
 * verbetering aan de site meteen ook in de app zit. De app regelt zelf alleen: foto/video kiezen of maken,
 * de terugknop, de kleuren van de systeembalken en video op volledig scherm.
 */
class MainActivity : ComponentActivity() {

    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private var fullscreen: View? = null

    private val picker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val cb = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        val data = result.data
        val uris: Array<Uri>? = when {
            result.resultCode != RESULT_OK -> null
            data?.clipData != null -> Array(data.clipData!!.itemCount) { data.clipData!!.getItemAt(it).uri }
            data?.data != null -> arrayOf(data.data!!)
            // camera: het bestand staat op de plek die we zelf opgaven
            cameraUri != null && File(cacheDir, "camera/" + cameraUri!!.lastPathSegment).length() > 0 -> arrayOf(cameraUri!!)
            else -> null
        }
        cb.onReceiveValue(uris)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        @Suppress("DEPRECATION")
        window.statusBarColor = Color.TRANSPARENT
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.TRANSPARENT

        root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        // De pagina blijft binnen status- en navigatiebalk en schuift mee met het toetsenbord.
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(sys.left, sys.top, sys.right, maxOf(sys.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        web.setBackgroundColor(Color.BLACK)
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            userAgentString = "$userAgentString SkittaLiteApp/1.1"
        }
        web.addJavascriptInterface(Bridge(), "BellieNative")
        web.webViewClient = object : WebViewClient() {
            // Andere sites in de gewone browser
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == HOST) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: ActivityNotFoundException) {}
                return true
            }
        }
        web.webChromeClient = Chrome()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (fullscreen != null) { (web.webChromeClient as Chrome).onHideCustomView(); return }
                web.evaluateJavascript("window.bcBack ? window.bcBack() : false") { handled ->
                    if (handled != "true") moveTaskToBack(true)
                }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl("https://$HOST/")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val video = params.acceptTypes.any { it.startsWith("video") }
            val pick = Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = if (video) "video/*" else "image/*"
            }
            // Ook meteen een foto of video kunnen maken
            val dir = File(cacheDir, "camera").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            val file = File(dir, if (video) "video.mp4" else "foto.jpg")
            val uri = FileProvider.getUriForFile(this@MainActivity, "nl.timvanbergen.belliechat.files", file)
            cameraUri = uri
            val camera = Intent(if (video) MediaStore.ACTION_VIDEO_CAPTURE else MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                if (video) putExtra(MediaStore.EXTRA_SIZE_LIMIT, 24L * 1024 * 1024)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(pick, if (video) "Video kiezen" else "Foto kiezen").apply {
                if (camera.resolveActivity(packageManager) != null) putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
            }
            return try {
                picker.launch(chooser)
                true
            } catch (_: ActivityNotFoundException) {
                fileCallback = null
                false
            }
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            fullscreen = view
            root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }

        override fun onHideCustomView() {
            fullscreen?.let { root.removeView(it) }
            fullscreen = null
        }
    }

    private inner class Bridge {
        /** De pagina meldt haar thema, zodat de systeembalken meekleuren. */
        @JavascriptInterface
        fun theme(dark: Boolean, background: String, bar: String) = runOnUiThread {
            val bg = try { Color.parseColor(background) } catch (_: IllegalArgumentException) { Color.BLACK }
            root.setBackgroundColor(bg)
            web.setBackgroundColor(bg)
            WindowCompat.getInsetsController(window, root).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }

    companion object {
        const val HOST = "skittalite.timvanbergen.nl"
    }
}
