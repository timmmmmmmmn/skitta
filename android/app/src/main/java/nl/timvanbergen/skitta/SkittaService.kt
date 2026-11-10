package nl.timvanbergen.skitta

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.webkit.CookieManager
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Houdt op de achtergrond één zuinige verbinding met Skitta open (zoals het oude Skype op Android),
 * zodat berichten en oproepen een melding geven als de app dicht is. Geen Google-diensten nodig.
 * Berichten zijn end-to-end versleuteld, dus de melding zegt alleen van wie het is.
 * Deze verbinding staat op "afwezig", zodat contactpersonen zien dat je niet achter je scherm zit.
 */
class SkittaService : Service() {

    private val main = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    private var socket: WebSocket? = null
    private var retryDelay = 2_000L
    private var stopped = false
    private var myId = 0L
    private val names = ConcurrentHashMap<Long, String>()
    private val convTitles = ConcurrentHashMap<Long, String>()
    private val seen = LinkedHashSet<Long>()
    private val rings = HashSet<String>()
    private val unread = ConcurrentHashMap<Long, Int>()
    private val mutedUntil = ConcurrentHashMap<Long, Long>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        Meldingen.channels(this)
        goForeground()
    }

    // Na elke startForegroundService() moet de dienst opnieuw startForeground() aanroepen.
    private fun goForeground() {
        val ongoing = Notification.Builder(this, Meldingen.CH_VERBINDING)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Skitta is verbonden")
            .setContentText("Tik om deze melding te verbergen")
            .setOngoing(false)
            .setShowWhen(false)
            .setContentIntent(Meldingen.hideConnection(this))
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(ONGOING_ID, ongoing, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
        } else {
            startForeground(ONGOING_ID, ongoing)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        goForeground()
        if (intent?.action == ACTION_CLEAR) {
            val c = intent.getLongExtra("c", 0L)
            if (c != 0L) Meldingen.clearConv(this, c) else Meldingen.clearMessages(this)
            if (c != 0L) unread.remove(c) else unread.clear()
            return START_STICKY
        }
        watchNetwork()
        if (socket == null) connect()
        return START_STICKY
    }

    override fun onDestroy() {
        network?.let { runCatching { getSystemService(android.net.ConnectivityManager::class.java).unregisterNetworkCallback(it) } }
        running = false
        stopped = true
        socket?.close(1000, null)
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun cookie(): String? = CookieManager.getInstance().getCookie(SITE)

    private fun connect() {
        if (stopped) return
        val c = cookie()
        if (c.isNullOrEmpty() || !c.contains("sid=")) {
            stopSelf()
            return
        }
        Thread { refreshNames() }.start()
        val req = Request.Builder().url("$WS/api/ws?dev=android-achtergrond").header("Cookie", c).build()
        socket = http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                retryDelay = 2_000L
                lastSeen = System.currentTimeMillis()
                webSocket.send("""{"t":"idle","on":true}""")
                schedulePing(webSocket)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                lastSeen = System.currentTimeMillis()
                runCatching { handle(JSONObject(text)) }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = retry(code)

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
                retry(response?.code ?: 0)
        })
    }

    // Elke 45 seconden een klein teken van leven; de server antwoordt zonder wakker te worden.
    // Komt er twee keer geen antwoord, dan is de verbinding stil weggevallen: opnieuw verbinden.
    @Volatile private var lastSeen = 0L

    private fun schedulePing(ws: WebSocket) {
        main.postDelayed({
            if (socket === ws && !stopped) {
                if (System.currentTimeMillis() - lastSeen > 100_000L) {
                    ws.cancel()
                    return@postDelayed
                }
                ws.send("""{"t":"ping"}""")
                schedulePing(ws)
            }
        }, 45_000L)
    }

    private var network: android.net.ConnectivityManager.NetworkCallback? = null

    // Wifi <-> 4G: de oude verbinding is dan dood, meteen een nieuwe maken.
    private fun watchNetwork() {
        if (network != null) return
        val cb = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(n: android.net.Network) {
                main.post {
                    if (stopped) return@post
                    retryDelay = 2_000L
                    main.removeCallbacksAndMessages(null)
                    socket?.cancel()
                    socket = null
                    connect()
                }
            }
        }
        network = cb
        runCatching { getSystemService(android.net.ConnectivityManager::class.java).registerDefaultNetworkCallback(cb) }
    }

    private fun retry(code: Int) {
        socket = null
        if (stopped) return
        if (code == 401 || code == 4001) {
            stopSelf()
            return
        }
        main.postDelayed({ connect() }, retryDelay)
        retryDelay = (retryDelay * 2).coerceAtMost(5 * 60_000L)
    }

    private fun get(path: String): String? = runCatching {
        val req = Request.Builder().url("$SITE/api/$path").header("Cookie", cookie() ?: "").build()
        http.newCall(req).execute().use { if (it.isSuccessful) it.body?.string() else null }
    }.getOrNull()

    private fun refreshNames() {
        get("me")?.let { myId = JSONObject(it).optLong("id") }
        get("contacts")?.let {
            val list = JSONArray(it)
            for (i in 0 until list.length()) {
                val u = list.getJSONObject(i)
                names[u.getLong("id")] = u.optString("display_name")
            }
        }
        get("conversations")?.let {
            val list = JSONArray(it)
            for (i in 0 until list.length()) {
                val c = list.getJSONObject(i)
                val members = c.optJSONArray("members") ?: JSONArray()
                for (j in 0 until members.length()) {
                    val m = members.getJSONObject(j)
                    names.putIfAbsent(m.getLong("id"), m.optString("display_name"))
                }
                if (c.optString("kind") == "group") convTitles[c.getLong("id")] = c.optString("topic").ifEmpty { "Groepsgesprek" }
                mutedUntil[c.getLong("id")] = c.optLong("muted_until", 0L)
            }
        }
    }

    private fun nameOf(id: Long): String {
        if (!names.containsKey(id)) refreshNames()
        return names[id] ?: "Skitta"
    }

    private fun handle(e: JSONObject) {
        when (e.optString("t")) {
            "msg" -> onMessage(e.getJSONObject("m"))
            "call" -> onCall(e)
            "contacts" -> {
                val from = e.optLong("request", 0L)
                Thread { refreshNames() }.start()
                if (from != 0L && !MainActivity.inFront) {
                    Thread {
                        Meldingen.show(this, from.toInt() + 2_000_000, Meldingen.CH_BERICHTEN, nameOf(from), "wil je toevoegen als contactpersoon", 0L)
                    }.start()
                }
            }
            "conv" -> Thread { refreshNames() }.start()
            "read" -> {
                if (e.optLong("u") == myId) {
                    val c = e.optLong("c")
                    unread.remove(c)
                    Meldingen.clearConv(this, c)
                }
            }
            "kick" -> {
                stopped = true
                stopSelf()
            }
        }
    }

    private fun onMessage(m: JSONObject) {
        val id = m.optLong("id")
        val from = m.optLong("u")
        val kind = m.optString("k")
        if (id == 0L || from == myId || kind == "system" || !seen.add(id)) return
        if (seen.size > 500) seen.remove(seen.first())
        if (m.optBoolean("del") || m.optBoolean("rm") || m.opt("ed") is Number) return
        if (MainActivity.inFront) return
        val c = m.optLong("c")
        Thread {
            if (myId == 0L) refreshNames()
            if (from == myId) return@Thread
            if ((mutedUntil[c] ?: 0L) > System.currentTimeMillis()) return@Thread
            val text = when (kind) {
                "photo" -> "Heeft een bijlage gestuurd"
                "call" -> if (runCatching { JSONObject(m.optString("b")).optBoolean("missed") }.getOrDefault(false)) "Gemiste oproep" else return@Thread
                else -> "Nieuw bericht"
            }
            val n = (unread[c] ?: 0) + 1
            unread[c] = n
            val who = nameOf(from)
            val title = convTitles[c]?.let { "$who in $it" } ?: who
            Meldingen.show(this, c.toInt(), Meldingen.CH_BERICHTEN, title, if (n > 1) "$n nieuwe berichten" else text, c)
        }.start()
    }

    private fun onCall(e: JSONObject) {
        val d = e.optJSONObject("d") ?: return
        val callId = d.optString("id")
        val from = e.optLong("from")
        when (d.optString("type")) {
            "ring" -> {
                if (MainActivity.inFront || !rings.add(callId)) return
                Thread { Meldingen.call(this, nameOf(from), d.optBoolean("video"), d.optLong("conv")) }.start()
            }
            "cancel", "taken", "hangup" -> {
                (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(Meldingen.CALL_ID)
                if (d.optString("type") == "cancel" && !MainActivity.inFront) {
                    Thread { Meldingen.show(this, Meldingen.CALL_ID + 1, Meldingen.CH_BERICHTEN, nameOf(from), "Gemiste oproep", d.optLong("conv")) }.start()
                }
            }
        }
    }

    companion object {
        val SITE: String = BuildConfig.SITE
        val HOST: String = android.net.Uri.parse(SITE).host ?: "skitta.timvanbergen.nl"
        private val WS: String = SITE.replaceFirst("http", "ws")
        const val ACTION_CLEAR = "nl.timvanbergen.skitta.CLEAR"
        private const val ONGOING_ID = 1
        private const val PREFS = "skitta"
        @Volatile var running = false

        fun enabled(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("achtergrond", true)

        fun setEnabled(context: Context, on: Boolean) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("achtergrond", on).apply()
            if (on) start(context) else context.stopService(Intent(context, SkittaService::class.java))
        }

        fun start(context: Context) {
            if (!enabled(context)) return
            val cookie = CookieManager.getInstance().getCookie(SITE)
            if (cookie.isNullOrEmpty() || !cookie.contains("sid=")) return
            runCatching { context.startForegroundService(Intent(context, SkittaService::class.java)) }
        }

        fun clear(context: Context, c: Long) {
            if (!enabled(context)) return
            runCatching { context.startService(Intent(context, SkittaService::class.java).setAction(ACTION_CLEAR).putExtra("c", c)) }
        }
    }
}

/** Meldingskanalen en het tonen van meldingen. */
object Meldingen {
    const val CH_VERBINDING = "verbinding"
    const val CH_BERICHTEN = "berichten"
    const val CH_OPROEPEN = "oproepen"
    const val CALL_ID = 999_000

    fun channels(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CH_VERBINDING, "Verbinding op de achtergrond", NotificationManager.IMPORTANCE_MIN).apply {
            description = "Houdt Skitta verbonden zodat je berichten en oproepen binnenkrijgt"
            setShowBadge(false)
        })
        nm.createNotificationChannel(NotificationChannel(CH_BERICHTEN, "Berichten", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Nieuwe berichten en contactverzoeken"
        })
        nm.createNotificationChannel(NotificationChannel(CH_OPROEPEN, "Oproepen", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Inkomende gesprekken"
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            )
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 600, 400, 600, 400, 600)
        })
    }

    /** Opent de instelling van alleen de melding "Skitta is verbonden"; uitzetten = weg, verbinding blijft. */
    fun hideConnectionIntent(context: Context): Intent =
        Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
            .putExtra(android.provider.Settings.EXTRA_CHANNEL_ID, CH_VERBINDING)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun hideConnection(context: Context): PendingIntent =
        PendingIntent.getActivity(context, 7, hideConnectionIntent(context), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun connectionHidden(context: Context): Boolean {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return nm.getNotificationChannel(CH_VERBINDING)?.importance == NotificationManager.IMPORTANCE_NONE
    }

    fun openApp(context: Context, c: Long): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("c", c)
        return PendingIntent.getActivity(context, c.toInt(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private const val GROUP = "skitta-berichten"
    private const val SUMMARY_ID = 2

    fun show(context: Context, id: Int, channel: String, title: String, text: String, c: Long) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val n = Notification.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(context.getColor(R.color.accent))
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setGroup(GROUP)
            .setContentIntent(openApp(context, c))
            .build()
        runCatching { nm.notify(id, n) }
        // Meerdere gesprekken: onder elkaar in één groep.
        val summary = Notification.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(context.getColor(R.color.accent))
            .setContentTitle("Skitta")
            .setContentText("Nieuwe berichten")
            .setGroup(GROUP)
            .setGroupSummary(true)
            .setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
            .setAutoCancel(true)
            .setContentIntent(openApp(context, 0))
            .build()
        runCatching { nm.notify(SUMMARY_ID, summary) }
    }

    /** De melding van één gesprek weg (gelezen); is er daarna niets meer over, dan ook de groep. */
    fun clearConv(context: Context, c: Long) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(c.toInt())
        val left = nm.activeNotifications.count { it.id != 1 && it.id != SUMMARY_ID && it.id != CALL_ID }
        if (left == 0) nm.cancel(SUMMARY_ID)
    }

    fun call(context: Context, name: String, video: Boolean, c: Long) {
        val open = openApp(context, c)
        val n = Notification.Builder(context, CH_OPROEPEN)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(context.getColor(R.color.accent))
            .setContentTitle(name)
            .setContentText(if (video) "wil met je videobellen" else "belt je")
            .setCategory(Notification.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(true)
            .setTimeoutAfter(45_000)
            .setContentIntent(open)
            .setFullScreenIntent(open, true)
            .addAction(Notification.Action.Builder(null, "Opnemen", open).build())
            .build()
        runCatching { (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(CALL_ID, n) }
    }

    fun clearMessages(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        for (s in nm.activeNotifications) if (s.id != 1) nm.cancel(s.id)
    }
}
