package nl.timvanbergen.skitta

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import nl.timvanbergen.skitta.glass.GlassBar
import nl.timvanbergen.skitta.glass.GlassMenu
import nl.timvanbergen.skitta.glass.records.GlassMenuItemRecord
import org.json.JSONObject
import java.io.File

/**
 * Skitta als app: de website (skitta.timvanbergen.nl) in een WebView, met de zwevende glazen
 * navigatie en glazen menu's van de app zelf (Android 13+). De rest van de pagina houdt de
 * klassieke Windows 7-stijl. Meldingen komen van SkittaService.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var bars: WindowInsetsControllerCompat
    private var glassMenu: GlassMenu? = null
    @Volatile private var insetTop = 0f
    @Volatile private var insetBottom = 0f
    private var pendingConv = 0L
    private var pageReady = false

    private var filePick: ValueCallback<Array<Uri>>? = null
    private var permissionRequest: PermissionRequest? = null

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

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val cb = filePick ?: return@registerForActivityResult
        filePick = null
        cb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data) ?: run {
            val clip = result.data?.clipData
            if (clip != null) Array(clip.itemCount) { clip.getItemAt(it).uri } else null
        })
    }

    private fun has(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    /**
     * Batterijbesparing legt achtergrond-apps stil (vooral op Samsung), dan komen meldingen te laat of niet.
     * Eén keer vragen of Skitta mag blijven draaien; daarna pas de vraag over de verbindingsmelding.
     */
    private fun askBattery(): Boolean {
        val pm = getSystemService(android.os.PowerManager::class.java)
        if (prefs().getBoolean("vroeg_batterij", false) || pm.isIgnoringBatteryOptimizations(packageName)) return false
        prefs().edit().putBoolean("vroeg_batterij", true).apply()
        web.postDelayed({
            if (isFinishing) return@postDelayed
            android.app.AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Meldingen altijd op tijd")
                .setMessage("Android legt apps op de achtergrond soms stil om batterij te sparen. Dan komen berichten en oproepen te laat of niet binnen.\n\nSta in het volgende scherm toe dat Skitta op de achtergrond mag blijven draaien. Skitta gebruikt daar bijna geen stroom voor.")
                .setPositiveButton("Toestaan") { _, _ ->
                    runCatching {
                        startActivity(Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
                    }
                }
                .setNegativeButton("Niet nu", null)
                .show()
        }, 2000)
        return true
    }

    /** Eén keer vragen of de melding "Skitta is verbonden" weg mag (de verbinding blijft gewoon werken). */
    private fun askHideConnection() {
        if (prefs().getBoolean("vroeg_verbergen", false) || Meldingen.connectionHidden(this)) return
        web.postDelayed({
            if (isFinishing) return@postDelayed
            prefs().edit().putBoolean("vroeg_verbergen", true).apply()
            android.app.AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Melding verbergen?")
                .setMessage("Android toont een melding \"Skitta is verbonden\" zolang Skitta op de achtergrond meldingen ophaalt. Die kun je uitzetten; je krijgt daarna nog steeds gewoon meldingen van berichten en oproepen.\n\nZet in het volgende scherm de schakelaar uit.")
                .setPositiveButton("Verbergen") { _, _ -> runCatching { startActivity(Meldingen.hideConnectionIntent(this)) } }
                .setNegativeButton("Niet nu", null)
                .show()
        }, 2500)
    }

    // ---- Privacy: schermbeveiliging en schermvergrendeling ----
    private fun prefs() = getSharedPreferences("skitta", Context.MODE_PRIVATE)
    private var cover: View? = null
    private var stoppedAt = 0L
    private var unlocking = false

    private fun applySecure() {
        if (prefs().getBoolean("secure", false)) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    /** Vergrendeld na een minuut weg (of bij opstarten): eerst vingerafdruk, gezicht of pincode. */
    private fun maybeLock() {
        if (!prefs().getBoolean("lock", false) || Build.VERSION.SDK_INT < 29 || unlocking) return
        if (stoppedAt != 0L && System.currentTimeMillis() - stoppedAt < 60_000) return
        val root = window.decorView as ViewGroup
        if (cover == null) {
            cover = FrameLayout(this).apply {
                setBackgroundColor(Color.WHITE)
                isClickable = true
                addView(android.widget.ImageView(this@MainActivity).apply { setImageResource(R.mipmap.ic_launcher) },
                    FrameLayout.LayoutParams(200, 200, android.view.Gravity.CENTER))
                setOnClickListener { maybeLock() }
            }
            root.addView(cover, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        unlocking = true
        val builder = android.hardware.biometrics.BiometricPrompt.Builder(this).setTitle("Skitta ontgrendelen")
        if (Build.VERSION.SDK_INT >= 30) {
            builder.setAllowedAuthenticators(
                android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK or
                    android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL
            )
        } else {
            @Suppress("DEPRECATION")
            builder.setDeviceCredentialAllowed(true)
        }
        builder.build().authenticate(android.os.CancellationSignal(), mainExecutor,
            object : android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: android.hardware.biometrics.BiometricPrompt.AuthenticationResult) {
                    unlocking = false
                    stoppedAt = System.currentTimeMillis()
                    cover?.let { (it.parent as? ViewGroup)?.removeView(it) }
                    cover = null
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    unlocking = false
                }
            })
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        @Suppress("DEPRECATION")
        window.statusBarColor = Color.TRANSPARENT
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
            @Suppress("DEPRECATION")
            window.isStatusBarContrastEnforced = false
        }
        // Inkomende oproep op een vergrendeld scherm: de app mag over het slot heen.
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }

        applySecure()
        // Alleen in testbuilds (tegen wrangler dev) de WebView te inspecteren.
        if (BuildConfig.SITE.startsWith("http://")) WebView.setWebContentsDebuggingEnabled(true)
        val root = FrameLayout(this)
        web = SkittaWebView(this) { uri, mime -> pasteFromKeyboard(uri, mime) }
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            glassMenu = GlassMenu(window.decorView as ViewGroup)
        }

        bars = WindowCompat.getInsetsController(window, root)
        bars.isAppearanceLightStatusBars = true
        bars.isAppearanceLightNavigationBars = true

        // Het toetsenbord: de webweergave krimpt beeldje voor beeldje mee terwijl het toetsenbord
        // omhoog of omlaag schuift (zoals in Signal), in plaats van in één keer te verspringen.
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            if (!imeAnimating) applyInsets(view, insets)
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.setWindowInsetsAnimationCallback(root, object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_STOP) {
            override fun onPrepare(animation: WindowInsetsAnimationCompat) {
                if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) imeAnimating = true
            }

            override fun onProgress(insets: WindowInsetsCompat, running: MutableList<WindowInsetsAnimationCompat>): WindowInsetsCompat {
                if (imeAnimating) applyInsets(root, insets)
                return insets
            }

            override fun onEnd(animation: WindowInsetsAnimationCompat) {
                if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) return
                imeAnimating = false
                ViewCompat.getRootWindowInsets(root)?.let { applyInsets(root, it) }
            }
        })

        CookieManager.getInstance().setAcceptCookie(true)
        web.setBackgroundColor(Color.WHITE)
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            builtInZoomControls = false
            userAgentString = "$userAgentString SkittaApp/${Updater.currentName(this@MainActivity)}"
        }
        web.addJavascriptInterface(Bridge(), "SkittaNative")
        web.webChromeClient = Chrome()
        web.webViewClient = Client()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.skittaBack ? window.skittaBack() : false") { handled ->
                    if (handled != "true") moveTaskToBack(true)
                }
            }
        })

        Meldingen.channels(this)
        pendingConv = intent?.getLongExtra("c", 0L) ?: 0L
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(HOME)
        Updater.checkQuietly(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val c = intent.getLongExtra("c", 0L)
        if (c != 0L) {
            pendingConv = c
            openPending()
        }
    }

    private fun openPending() {
        val c = pendingConv
        if (c == 0L || !pageReady) return
        pendingConv = 0L
        web.evaluateJavascript("window.skittaOpen && skittaOpen($c)", null)
    }

    /** Afbeelding van het toetsenbord: lezen (zolang we toestemming hebben) en aan de pagina geven. */
    private fun pasteFromKeyboard(uri: Uri, mime: String) {
        val bytes = runCatching { contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull() ?: return
        if (bytes.size > 40 * 1024 * 1024) return
        val data = Base64.encodeToString(bytes, Base64.NO_WRAP)
        web.evaluateJavascript("window.skittaPasteImage && skittaPasteImage(${JSONObject.quote(data)}, ${JSONObject.quote(mime)})", null)
    }

    private var imeAnimating = false

    private fun applyInsets(view: View, insets: WindowInsetsCompat) {
        val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
        val density = resources.displayMetrics.density
        // Zolang het toetsenbord lager is dan de navigatiebalk, houdt de pagina zelf die ruimte vrij.
        val pad = if (ime > sys.bottom) ime else 0
        val top = sys.top / density
        val bottom = if (ime > sys.bottom) 0f else (sys.bottom - ime) / density
        if (view.paddingBottom != pad || view.paddingLeft != sys.left || view.paddingRight != sys.right) {
            view.setPadding(sys.left, 0, sys.right, pad)
        }
        if (top != insetTop || bottom != insetBottom) {
            insetTop = top
            insetBottom = bottom
            pushInsets()
        }
    }

    private fun pushInsets() {
        web.evaluateJavascript(
            "(function(r){r.setProperty('--sat','${insetTop}px');r.setProperty('--sab','${insetBottom}px');})(document.documentElement.style);" +
                "window.dispatchEvent(new Event('resize'))",
            null
        )
    }

    private fun windowRect(box: JSONObject): RectF {
        val density = resources.displayMetrics.density
        val origin = IntArray(2).also { web.getLocationInWindow(it) }
        val left = origin[0] + box.getDouble("x").toFloat() * density
        val top = origin[1] + box.getDouble("y").toFloat() * density
        return RectF(left, top, left + box.getDouble("w").toFloat() * density, top + box.getDouble("h").toFloat() * density)
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun showGlassMenu(menu: JSONObject) {
        val rows = menu.getJSONArray("items")
        val items = List(rows.length()) { i ->
            val row = rows.getJSONObject(i)
            GlassMenuItemRecord(
                id = row.optString("id"),
                title = row.optString("title"),
                subtitle = row.optString("subtitle").ifEmpty { null },
                icon = row.optString("icon").ifEmpty { null },
                checked = if (row.has("checked")) row.optBoolean("checked") else null,
                destructive = row.optBoolean("destructive"),
                disabled = row.optBoolean("disabled"),
                separator = row.optBoolean("separator"),
                heading = row.optBoolean("heading"),
            )
        }
        glassMenu?.show(windowRect(menu), items, menu.optBoolean("dark")) { id ->
            web.evaluateJavascript("window.skittaGlassPick && skittaGlassPick(${JSONObject.quote(id)})", null)
        }
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun showGlassBar(bar: JSONObject) {
        val tabs = bar.getJSONArray("tabs")
        glassMenu?.setBar(
            windowRect(bar.getJSONObject("pill")),
            windowRect(bar.getJSONObject("add")),
            List(tabs.length()) { i ->
                val tab = tabs.getJSONObject(i)
                GlassBar.Tab(tab.getString("id"), tab.getString("title"), tab.getString("icon"))
            },
            bar.getString("active"),
            bar.optBoolean("dark"),
            bar.optBoolean("visible", true),
        ) { id ->
            web.evaluateJavascript("window.skittaGlassNav && skittaGlassNav(${JSONObject.quote(id)})", null)
        }
    }

    fun updateReady(name: String) {
        web.evaluateJavascript(
            "window.skittaToast && skittaToast(${JSONObject.quote("Versie $name staat klaar en wordt geïnstalleerd zodra je de app sluit")})",
            null
        )
    }

    private var offline = false

    private fun showOffline() {
        offline = true
        val dark = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
        val bg = if (dark) "#121416" else "#ffffff"
        val fg = if (dark) "#e9ecef" else "#1b1b1b"
        val html = """<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
            <body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:$bg;color:$fg;font:16px -apple-system,Roboto,sans-serif;text-align:center;padding:24px;box-sizing:border-box">
            <div style="font-size:54px">📡</div><b style="font-size:20px">Geen verbinding</b>
            <div style="opacity:.7">Skitta probeert het vanzelf opnieuw zodra je weer internet hebt.</div>
            <button onclick="SkittaNative.retry()" style="margin-top:8px;border:0;border-radius:22px;padding:12px 26px;background:#0a93d1;color:#fff;font-size:16px;font-weight:600">Opnieuw proberen</button>
            </body>"""
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
        watchNetwork()
    }

    private var networkCallback: android.net.ConnectivityManager.NetworkCallback? = null

    private fun watchNetwork() {
        if (networkCallback != null) return
        val cm = getSystemService(android.net.ConnectivityManager::class.java)
        networkCallback = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) {
                runOnUiThread { if (offline) retry() }
            }
        }
        runCatching { cm.registerDefaultNetworkCallback(networkCallback!!) }
    }

    fun retry() {
        offline = false
        web.loadUrl(HOME)
    }

    private fun onOurSite(): Boolean = web.url?.let { Uri.parse(it).host == HOST } ?: false

    override fun onResume() {
        super.onResume()
        inFront = true
        SkittaService.start(this)
        // Meldingen verdwijnen per gesprek zodra je het leest (hier, of op een ander apparaat).
        // Contactverzoeken zie je in de app; die meldingen mogen weg.
        (getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).activeNotifications
            .filter { it.id >= 2_000_000 }.forEach { (getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).cancel(it.id) }
        Updater.resume(this)
        Updater.checkQuietly(this)
        // Het gesprek dat open staat is nu gelezen; dan verdwijnt ook de melding ervan.
        if (pageReady) web.evaluateJavascript("window.skittaResume && skittaResume()", null)
    }

    override fun onPause() {
        super.onPause()
        inFront = false
        CookieManager.getInstance().flush()
    }

    override fun onStart() {
        super.onStart()
        maybeLock()
        web.onResume()
        web.resumeTimers()
    }

    override fun onStop() {
        super.onStop()
        if (!unlocking && cover == null) stoppedAt = System.currentTimeMillis()
        // Niet in beeld en niet aan het bellen: de pagina pauzeren (geen geluid, geen stroom).
        // De achtergrondverbinding geeft de meldingen.
        if (!callActive) {
            web.onPause()
            web.pauseTimers()
        }
        Updater.installIfReady(this)
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        web.evaluateJavascript("window.applyMode && applyMode()", null)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        networkCallback?.let { cb -> runCatching { getSystemService(android.net.ConnectivityManager::class.java).unregisterNetworkCallback(cb) } }
        web.destroy()
        super.onDestroy()
    }

    /** Wat de pagina van de app mag vragen (window.SkittaNative). */
    private inner class Bridge {

        @JavascriptInterface
        fun platform(): String = "android"

        @JavascriptInterface
        fun insets(): String = "$insetTop,$insetBottom"

        /** Of de app in beeld is; anders speelt de pagina geen geluid (de meldingen doen dat). */
        @JavascriptInterface
        fun inFront(): Boolean = MainActivity.inFront

        /** Niet storen staat aan: geen geluiden in de app. */
        @JavascriptInterface
        fun quiet(): Boolean {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            return nm.currentInterruptionFilter > android.app.NotificationManager.INTERRUPTION_FILTER_ALL
        }

        /** Tijdens een gesprek blijft de pagina actief, ook als de app niet in beeld is. */
        @JavascriptInterface
        fun callActive(on: Boolean) {
            callActive = on
        }

        /** Alleen als de achtergrondverbinding niet draait; anders geeft die de melding al. */
        @JavascriptInterface
        fun notify(title: String, body: String, c: String, kind: String) {
            if (inFront || SkittaService.running) return
            val conv = c.toLongOrNull() ?: 0L
            if (kind == "call") Meldingen.call(this@MainActivity, title, false, conv)
            else Meldingen.show(this@MainActivity, conv.toInt(), Meldingen.CH_BERICHTEN, title, body, conv)
        }

        @JavascriptInterface
        fun badge(n: Int) {
            // Android toont het aantal zelf als stip op het icoon (via de meldingen).
        }

        @JavascriptInterface
        fun haptic(kind: String) {
            runOnUiThread {
                val effect = when {
                    kind == "confirm" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> HapticFeedbackConstants.CONFIRM
                    kind == "long" -> HapticFeedbackConstants.LONG_PRESS
                    else -> HapticFeedbackConstants.CLOCK_TICK
                }
                web.performHapticFeedback(effect)
            }
        }

        @JavascriptInterface
        fun glassUi(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

        @JavascriptInterface
        fun glassMenu(json: String): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
            val menu = JSONObject(json)
            runOnUiThread { if (onOurSite()) showGlassMenu(menu) }
            return true
        }

        @JavascriptInterface
        fun glassBar(json: String) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
            val bar = JSONObject(json)
            runOnUiThread { if (onOurSite()) showGlassBar(bar) }
        }

        /** Ingelogd en geladen: meldingen toestaan, achtergrondverbinding starten, wachtend gesprek openen. */
        @JavascriptInterface
        fun ready() {
            runOnUiThread {
                pageReady = true
                CookieManager.getInstance().flush()
                if (Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS)) {
                    askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
                SkittaService.start(this@MainActivity)
                if (!askBattery()) askHideConnection()
                openPending()
                Updater.justUpdated(this@MainActivity)?.let { name ->
                    web.evaluateJavascript("window.skittaToast && skittaToast(${JSONObject.quote("Bijgewerkt naar versie $name")})", null)
                }
            }
        }

        /** Afgemeld: achtergrondverbinding stoppen. */
        @JavascriptInterface
        fun signedOut() {
            stopService(Intent(this@MainActivity, SkittaService::class.java))
        }

        /** Of de telefoon op donker staat (voor "automatisch"). */
        @JavascriptInterface
        fun systemDark(): Boolean =
            (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES

        /** Donkere modus: lichte statusbalk-iconen en een donkere achtergrond. */
        @JavascriptInterface
        fun setDark(dark: Boolean) {
            runOnUiThread {
                bars.isAppearanceLightStatusBars = !dark
                bars.isAppearanceLightNavigationBars = !dark
                web.setBackgroundColor(if (dark) Color.rgb(18, 20, 22) else Color.WHITE)
            }
        }

        // ---- Video's afspelen in de eigen speler: de pagina stuurt de ontsleutelde video in stukjes ----
        private fun videoFile(id: String) = File(VideoActivity.dir(this@MainActivity), id.replace(Regex("[^A-Za-z0-9_-]"), "_") + ".bin")

        @JavascriptInterface
        fun videoBegin(id: String) {
            VideoActivity.dir(this@MainActivity).listFiles()?.forEach { it.delete() }
            videoFile(id).writeBytes(ByteArray(0))
        }

        @JavascriptInterface
        fun videoChunk(id: String, base64: String) {
            videoFile(id).appendBytes(Base64.decode(base64, Base64.DEFAULT))
        }

        /** Grote video: meteen streamen in de eigen speler (geen omweg via de pagina). */
        @JavascriptInterface
        fun videoStream(url: String, token: String, key: String, size: String, mime: String, title: String) {
            runOnUiThread { VideoActivity.stream(this@MainActivity, url, token, key, size.toLongOrNull() ?: 0L, mime, title) }
        }

        @JavascriptInterface
        fun videoPlay(id: String, mime: String, title: String) {
            runOnUiThread { VideoActivity.start(this@MainActivity, videoFile(id), mime, title) }
        }

        /** Foto of video van het klembord (de WebView kan geen afbeeldingen plakken). Leeg = niets bruikbaars. */
        @JavascriptInterface
        fun clipboardImage(): String {
            val cm = getSystemService(android.content.ClipboardManager::class.java) ?: return ""
            val clip = runCatching { cm.primaryClip }.getOrNull() ?: return ""
            for (i in 0 until clip.itemCount) {
                val uri = clip.getItemAt(i).uri ?: continue
                val mime = contentResolver.getType(uri) ?: continue
                if (!mime.startsWith("image/") && !mime.startsWith("video/")) continue
                val bytes = runCatching { contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull() ?: continue
                if (bytes.size > 40 * 1024 * 1024) return ""
                return JSONObject().put("mime", mime).put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)).toString()
            }
            return ""
        }

        /** Gesprek geopend of gelezen: de melding ervan weghalen. */
        @JavascriptInterface
        fun clearConv(c: String) {
            val conv = c.toLongOrNull() ?: return
            runOnUiThread {
                Meldingen.clearConv(this@MainActivity, conv)
                SkittaService.clear(this@MainActivity, conv)
            }
        }

        @JavascriptInterface
        fun retry() {
            runOnUiThread { this@MainActivity.retry() }
        }

        @JavascriptInterface
        fun hideConnection() {
            runOnUiThread { runCatching { startActivity(Meldingen.hideConnectionIntent(this@MainActivity)) } }
        }

        @JavascriptInterface
        fun secure(): Boolean = prefs().getBoolean("secure", false)

        @JavascriptInterface
        fun setSecure(on: Boolean) {
            prefs().edit().putBoolean("secure", on).apply()
            runOnUiThread { applySecure() }
        }

        @JavascriptInterface
        fun lock(): Boolean = prefs().getBoolean("lock", false)

        @JavascriptInterface
        fun setLock(on: Boolean) {
            prefs().edit().putBoolean("lock", on).apply()
        }

        @JavascriptInterface
        fun background(): Boolean = SkittaService.enabled(this@MainActivity)

        @JavascriptInterface
        fun setBackground(on: Boolean) {
            SkittaService.setEnabled(this@MainActivity, on)
        }

        /** Een bijlage opslaan in Downloads. */
        @JavascriptInterface
        fun save(name: String, mime: String, base64: String) {
            Thread {
                val ok = runCatching {
                    val bytes = Base64.decode(base64, Base64.DEFAULT)
                    val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "bestand" }
                    if (Build.VERSION.SDK_INT >= 29) {
                        val values = ContentValues().apply {
                            put(MediaStore.Downloads.DISPLAY_NAME, safe)
                            put(MediaStore.Downloads.MIME_TYPE, mime)
                            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Skitta")
                        }
                        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("geen plek")
                        contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
                    } else {
                        val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: filesDir
                        File(dir, safe).writeBytes(bytes)
                    }
                }.isSuccess
                runOnUiThread {
                    Toast.makeText(this@MainActivity, if (ok) "Opgeslagen in Downloads/Skitta" else "Opslaan is mislukt", Toast.LENGTH_SHORT).show()
                }
            }.start()
        }

        @JavascriptInterface
        fun appVersion(): String = Updater.currentName(this@MainActivity)

        @JavascriptInterface
        fun checkForUpdate() {
            runOnUiThread { Updater.check(this@MainActivity, manual = true) }
        }
    }

    private inner class Chrome : WebChromeClient() {
        // Camera en microfoon voor bellen en spraakberichten.
        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread {
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

        // Foto's, video's en bestanden kiezen.
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            filePick?.onReceiveValue(null)
            filePick = callback
            return try {
                val pick = params.createIntent().putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                pickFiles.launch(pick)
                true
            } catch (_: ActivityNotFoundException) {
                filePick = null
                false
            }
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (request.url.host == HOST && !request.url.path.orEmpty().startsWith("/beheer")) return false
            try {
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
            } catch (_: ActivityNotFoundException) {
            }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            pageReady = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) glassMenu?.hideBar()
        }

        override fun onPageCommitVisible(view: WebView, url: String?) = pushInsets()

        override fun onPageFinished(view: WebView, url: String?) {
            pushInsets()
            CookieManager.getInstance().flush()
        }

        // Geen internet: een nette pagina in plaats van een foutscherm, en vanzelf opnieuw zodra er weer verbinding is.
        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
            if (!request.isForMainFrame) return
            showOffline()
        }
    }

    companion object {
        val HOST: String get() = SkittaService.HOST
        private val HOME: String get() = "${SkittaService.SITE}/"
        @Volatile var inFront = false
        @Volatile var callActive = false
    }
}

/** Na het opstarten van de telefoon: weer verbinden voor meldingen. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            SkittaService.start(context)
        }
    }
}
