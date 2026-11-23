package nl.timvanbergen.belliechat

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
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
 * de terugknop, de kleuren van de systeembalken, video op volledig scherm, microfoon/camera voor bellen en
 * meldingen (LiteService).
 */
class MainActivity : ComponentActivity() {

    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private var fullscreen: View? = null
    private var permissionRequest: PermissionRequest? = null
    private var pageReady = false
    private var pendingOpen: Pair<Long, Boolean>? = null

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private val askMedia = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val req = permissionRequest ?: return@registerForActivityResult
        permissionRequest = null
        val allowed = req.resources.filter { r ->
            when (r) {
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> result[Manifest.permission.RECORD_AUDIO] ?: has(Manifest.permission.RECORD_AUDIO)
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> result[Manifest.permission.CAMERA] ?: has(Manifest.permission.CAMERA)
                else -> false
            }
        }
        if (allowed.isEmpty()) req.deny() else req.grant(allowed.toTypedArray())
    }

    private fun has(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

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
            userAgentString = "$userAgentString SkittaLiteApp/1.2"
        }
        web.addJavascriptInterface(Bridge(), "BellieNative")
        web.webViewClient = object : WebViewClient() {
            // Andere sites in de gewone browser
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == HOST) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: ActivityNotFoundException) {}
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                pageReady = false
            }

            override fun onPageFinished(view: WebView, url: String?) {
                pageReady = true
                openPending()
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

        takeOpen(intent)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl("https://$HOST/")
    }

    // Uit een melding: welk gesprek, en of de oproep meteen opgenomen moet worden.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        takeOpen(intent)
        if (pageReady) openPending()
    }

    private fun takeOpen(intent: Intent?) {
        val c = intent?.getLongExtra("c", -1L) ?: -1L
        if (c < 0) return
        pendingOpen = Pair(c, intent?.getBooleanExtra("answer", false) ?: false)
        intent?.removeExtra("c")
        if (pendingOpen!!.second) Meldingen.cancelCall(this)
    }

    private fun openPending() {
        val (c, answer) = pendingOpen ?: return
        pendingOpen = null
        web.evaluateJavascript("window.liteOpen && liteOpen($c, $answer)", null)
    }

    /** Eén keer vragen of Skitta Lite op de achtergrond mag blijven draaien; anders komen meldingen te laat. */
    private fun askBattery() {
        val prefs = getSharedPreferences("lite", MODE_PRIVATE)
        val pm = getSystemService(android.os.PowerManager::class.java)
        if (prefs.getBoolean("vroeg_batterij", false) || pm.isIgnoringBatteryOptimizations(packageName)) return
        prefs.edit().putBoolean("vroeg_batterij", true).apply()
        android.app.AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Meldingen altijd op tijd")
            .setMessage("Android legt apps op de achtergrond soms stil om batterij te sparen. Dan komen berichten en oproepen te laat of niet binnen.\n\nSta in het volgende scherm toe dat Skitta Lite op de achtergrond mag blijven draaien. Dat kost bijna geen stroom.")
            .setPositiveButton("Toestaan") { _, _ ->
                runCatching {
                    @SuppressLint("BatteryLife")
                    val i = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
                    startActivity(i)
                }
            }
            .setNegativeButton("Niet nu", null)
            .show()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        inFront = true
        web.onResume()
        // De app is open: de chatlijst laat zien wat nieuw is, de meldingen mogen weg.
        LiteService.send(this, Intent(LiteService.ACTION_CLEAR))
    }

    override fun onPause() {
        inFront = false
        // Tijdens een gesprek blijft de pagina gewoon doorlopen (geluid en microfoon).
        if (!callActive) web.onPause()
        super.onPause()
    }

    private inner class Chrome : WebChromeClient() {
        // Microfoon en camera voor bellen.
        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread {
                if (Uri.parse(request.origin.toString()).host != HOST) { request.deny(); return@runOnUiThread }
                val need = mutableListOf<String>()
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources && !has(Manifest.permission.RECORD_AUDIO)) need += Manifest.permission.RECORD_AUDIO
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources && !has(Manifest.permission.CAMERA)) need += Manifest.permission.CAMERA
                if (need.isEmpty()) {
                    request.grant(request.resources)
                } else {
                    permissionRequest = request
                    askMedia.launch(need.toTypedArray())
                }
            }
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val video = params.acceptTypes.any { it.startsWith("video") }
            // De app heeft (voor bellen) camerarechten in het manifest; dan mag de camera-app alleen als die
            // rechten er ook echt zijn. Eerst vragen, daarna pas kiezen.
            if (!has(Manifest.permission.CAMERA) && !getSharedPreferences("lite", MODE_PRIVATE).getBoolean("vroeg_camera", false)) {
                getSharedPreferences("lite", MODE_PRIVATE).edit().putBoolean("vroeg_camera", true).apply()
                pendingChooser = video
                askCamera.launch(Manifest.permission.CAMERA)
                return true
            }
            return openChooser(video)
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

    private var pendingChooser: Boolean? = null
    private val askCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        val video = pendingChooser ?: return@registerForActivityResult
        pendingChooser = null
        if (!openChooser(video)) { fileCallback?.onReceiveValue(null); fileCallback = null }
    }

    private fun openChooser(video: Boolean): Boolean {
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
            if (has(Manifest.permission.CAMERA) && camera.resolveActivity(packageManager) != null) putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
        }
        return try {
            picker.launch(chooser)
            true
        } catch (_: ActivityNotFoundException) {
            fileCallback = null
            false
        }
    }

    private inner class Bridge {
        /** Ingelogd (token) of afgemeld (leeg): de achtergrondverbinding voor meldingen starten of stoppen. */
        @JavascriptInterface
        fun session(token: String, me: Double) = runOnUiThread {
            val first = token.isNotEmpty() && LiteService.token(this@MainActivity).isEmpty()
            LiteService.setSession(this@MainActivity, token, me.toLong())
            if (token.isEmpty()) return@runOnUiThread
            if (Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS)) {
                askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else if (first || !getSharedPreferences("lite", MODE_PRIVATE).getBoolean("vroeg_batterij", false)) {
                askBattery()
            }
        }

        /** Of de app in beeld is (anders rinkelt de belmelding, niet de pagina). */
        @JavascriptInterface
        fun front(): Boolean = inFront

        /** Gesprek begonnen of afgelopen: de pagina mag dan niet gepauzeerd worden, de microfoon blijft aan. */
        @JavascriptInterface
        fun callActive(on: Boolean) {
            callActive = on
            LiteService.send(this@MainActivity, Intent(LiteService.ACTION_CALL).putExtra("on", on))
            runOnUiThread {
                if (on) window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }

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
        @Volatile var inFront = false
        @Volatile var callActive = false
    }
}
