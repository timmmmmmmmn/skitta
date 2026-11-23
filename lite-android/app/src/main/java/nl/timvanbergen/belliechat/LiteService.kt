package nl.timvanbergen.belliechat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Houdt op de achtergrond één zuinige verbinding met Skitta open (net als de Skitta-app), zodat berichten en
 * oproepen een melding geven als Skitta Lite dicht is. Geen Google-diensten nodig. Chats met Skitta Lite zijn
 * niet versleuteld, dus de melding laat de tekst zelf zien. Inloggen gaat met het token van de webapp
 * (BellieNative.session), net als in de pagina zelf.
 */
class LiteService : Service() {

    private val main = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    private var socket: WebSocket? = null
    private var retryDelay = 2_000L
    private var stopped = false
    private val names = ConcurrentHashMap<Long, String>()
    private val convNames = ConcurrentHashMap<Long, String>()
    private val seen = LinkedHashSet<Long>()
    private val rings = HashSet<String>()
    private val ringInfo = HashMap<String, Pair<Long, Long>>() // oproep -> (gesprek, beller)
    private val ringDev = HashMap<String, String>() // oproep -> apparaat van de beller
    private val lines = ConcurrentHashMap<Long, MutableList<String>>()
    @Volatile private var lastRefresh = 0L
    @Volatile private var lastSeen = 0L
    @Volatile private var inCall = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        Meldingen.channels(this)
        goForeground()
    }

    // Na elke startForegroundService() moet de dienst opnieuw startForeground() aanroepen. Tijdens een gesprek
    // ook als "microfoon", anders zet Android de microfoon uit zodra de app op de achtergrond staat.
    private fun goForeground() {
        val ongoing = Notification.Builder(this, if (inCall) Meldingen.CH_GESPREK else Meldingen.CH_VERBINDING)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(if (inCall) "In gesprek" else "Skitta Lite is verbonden")
            .setContentText(if (inCall) "Tik om terug te gaan naar het gesprek" else "Tik om deze melding te verbergen")
            .setShowWhen(false)
            .setOngoing(inCall)
            .setContentIntent(if (inCall) Meldingen.openApp(this, 0L) else Meldingen.hideConnection(this))
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            val mic = inCall && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            val type = ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING or (if (mic) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
            runCatching { startForeground(ONGOING_ID, ongoing, type) }
                .onFailure { startForeground(ONGOING_ID, ongoing, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING) }
        } else {
            startForeground(ONGOING_ID, ongoing)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CALL -> inCall = intent.getBooleanExtra("on", false)
            ACTION_CLEAR -> {
                val c = intent.getLongExtra("c", 0L)
                if (c == 0L) {
                    lines.clear()
                    Meldingen.clearAll(this)
                } else {
                    lines.remove(c)
                    Meldingen.clearConv(this, c)
                }
            }
            ACTION_DECLINE -> decline(intent.getStringExtra("id").orEmpty())
        }
        goForeground()
        if (token(this).isEmpty()) {
            stopSelf()
            return START_NOT_STICKY
        }
        watchNetwork()
        if (socket == null) connect()
        return START_STICKY
    }

    override fun onDestroy() {
        network?.let { runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } }
        running = false
        stopped = true
        socket?.close(1000, null)
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun connect() {
        if (stopped) return
        val t = token(this)
        if (t.isEmpty()) {
            stopSelf()
            return
        }
        Thread { refreshNames() }.start()
        val url = "wss://${MainActivity.HOST}/api/ws?dev=android-achtergrond&t=" + URLEncoder.encode(t, "UTF-8")
        socket = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
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

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = retry(webSocket, code)

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
                retry(webSocket, response?.code ?: 0)
        })
    }

    // Elke 75 seconden een klein teken van leven (net onder de 100 s waarna Cloudflare een stille verbinding
    // sluit). Komt er twee keer geen antwoord, dan is de verbinding stil weggevallen.
    private fun schedulePing(ws: WebSocket) {
        main.postDelayed({
            if (socket === ws && !stopped) {
                if (System.currentTimeMillis() - lastSeen > 170_000L) {
                    ws.cancel()
                    return@postDelayed
                }
                ws.send("""{"t":"ping"}""")
                schedulePing(ws)
            }
        }, 75_000L)
    }

    private var network: ConnectivityManager.NetworkCallback? = null

    // Wifi <-> 4G: de oude verbinding is dan dood, meteen een nieuwe maken.
    private fun watchNetwork() {
        if (network != null) return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(n: Network) {
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
        runCatching { getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(cb) }
    }

    private fun retry(ws: WebSocket, code: Int) {
        main.post {
            if (socket !== ws) return@post
            socket = null
            if (stopped) return@post
            if (code == 401 || code == 4001) {
                stopSelf()
                return@post
            }
            main.postDelayed({ if (socket == null) connect() }, retryDelay)
            retryDelay = (retryDelay * 2).coerceAtMost(5 * 60_000L)
        }
    }

    // Namen van de mensen met wie je chat (de server stuurt alleen nummers mee).
    private fun refreshNames() {
        val body = runCatching {
            val req = Request.Builder().url("https://${MainActivity.HOST}/api/lite/chats").header("Authorization", "Bearer ${token(this)}").build()
            http.newCall(req).execute().use { if (it.isSuccessful) it.body?.string() else null }
        }.getOrNull() ?: return
        val r = JSONObject(body)
        val list = r.optJSONArray("chats") ?: return
        for (i in 0 until list.length()) {
            val c = list.getJSONObject(i)
            val u = c.optJSONObject("user") ?: continue
            names[u.optLong("id")] = u.optString("name")
            convNames[c.optLong("id")] = u.optString("name")
        }
    }

    private fun nameOf(id: Long): String {
        if (!names.containsKey(id)) refreshNames()
        return names[id] ?: "Skitta Lite"
    }

    private fun handle(e: JSONObject) {
        when (e.optString("t")) {
            "msg" -> onMessage(e.getJSONObject("m"))
            "call" -> onCall(e)
            "conv", "contacts" -> {
                val now = System.currentTimeMillis()
                if (now - lastRefresh > 30_000L) {
                    lastRefresh = now
                    Thread { refreshNames() }.start()
                }
            }
            "read" -> if (e.optLong("u") == myId(this)) {
                val c = e.optLong("c")
                lines.remove(c)
                Meldingen.clearConv(this, c)
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
        if (id == 0L || from == myId(this) || kind == "system" || !seen.add(id)) return
        if (seen.size > 500) seen.remove(seen.first())
        if (m.optBoolean("del") || m.optBoolean("rm") || m.opt("ed") is Number) return
        if (MainActivity.inFront) return
        val c = m.optLong("c")
        Thread {
            val text = when {
                kind == "call" -> if (runCatching { JSONObject(m.optString("b")).optBoolean("missed") }.getOrDefault(false)) "Gemiste oproep" else return@Thread
                m.optBoolean("e") -> "Nieuw bericht"
                kind == "photo" -> {
                    val t = runCatching { JSONObject(m.optString("b")).optString("t") }.getOrDefault("")
                    when (t) { "video" -> "Video"; "voice" -> "Spraakbericht"; "file" -> "Bestand"; else -> "Foto" }
                }
                else -> m.optString("b").ifEmpty { "Nieuw bericht" }
            }
            val list = lines.getOrPut(c) { mutableListOf() }
            synchronized(list) {
                list += text
                while (list.size > 6) list.removeAt(0)
            }
            Meldingen.message(this, c, convNames[c] ?: nameOf(from), synchronized(list) { list.toList() })
        }.start()
    }

    private fun onCall(e: JSONObject) {
        val d = e.optJSONObject("d") ?: return
        val callId = d.optString("id")
        val from = e.optLong("from")
        when (d.optString("type")) {
            "ring" -> {
                if (from == myId(this) || inCall) return
                ringInfo[callId] = Pair(d.optLong("conv"), from)
                ringDev[callId] = e.optString("dev")
                if (MainActivity.inFront || !rings.add(callId)) return
                Thread { Meldingen.call(this, nameOf(from), d.optBoolean("video"), d.optLong("conv"), callId) }.start()
                // Komt er geen "opgehangen" meer (beller zonder verbinding), dan na een minuut weg.
                main.postDelayed({ Meldingen.cancelCall(this, callId) }, 60_000L)
            }
            "cancel", "taken", "hangup" -> {
                Meldingen.cancelCall(this, callId)
                if (d.optString("type") == "cancel" && !MainActivity.inFront) {
                    val conv = ringInfo[callId]?.first ?: 0L
                    Thread {
                        val list = lines.getOrPut(conv) { mutableListOf() }
                        synchronized(list) { list += "Gemiste oproep" }
                        Meldingen.message(this, conv, nameOf(from), synchronized(list) { list.toList() })
                    }.start()
                }
            }
        }
    }

    // "Weigeren" in de belmelding: de beller hoort dat meteen, je andere apparaten stoppen met bellen.
    private fun decline(id: String) {
        Meldingen.cancelCall(this, id)
        val from = ringInfo[id]?.second ?: return
        val ws = socket ?: return
        val dev = ringDev[id]?.let { if (it.isNotEmpty()) ""","dev":${JSONObject.quote(it)}""" else "" } ?: ""
        ws.send("""{"t":"call","to":$from$dev,"d":{"type":"decline","id":${JSONObject.quote(id)}}}""")
        ws.send("""{"t":"call","to":${myId(this)},"d":{"type":"taken","id":${JSONObject.quote(id)}}}""")
    }

    companion object {
        const val ACTION_CLEAR = "nl.timvanbergen.belliechat.CLEAR"
        const val ACTION_CALL = "nl.timvanbergen.belliechat.CALL"
        const val ACTION_DECLINE = "nl.timvanbergen.belliechat.DECLINE"
        private const val ONGOING_ID = 1
        private const val PREFS = "lite"
        @Volatile var running = false

        private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        fun token(context: Context): String = prefs(context).getString("token", "") ?: ""
        fun myId(context: Context): Long = prefs(context).getLong("me", 0L)

        /** De pagina meldt wie er is ingelogd (leeg token = afgemeld). */
        fun setSession(context: Context, token: String, me: Long) {
            val old = token(context)
            prefs(context).edit().putString("token", token).putLong("me", me).apply()
            if (token.isEmpty()) {
                context.stopService(Intent(context, LiteService::class.java))
                Meldingen.clearAll(context)
            } else if (token != old && running) {
                context.stopService(Intent(context, LiteService::class.java))
                start(context)
            } else {
                start(context)
            }
        }

        fun start(context: Context) {
            if (token(context).isEmpty()) return
            runCatching { context.startForegroundService(Intent(context, LiteService::class.java)) }
        }

        fun send(context: Context, intent: Intent) {
            if (token(context).isEmpty()) return
            runCatching { context.startForegroundService(intent.setClass(context, LiteService::class.java)) }
        }
    }
}

/** Na het opstarten van de telefoon of een update: weer verbinden voor meldingen. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            LiteService.start(context)
        }
    }
}

/** "Weigeren" in de belmelding. */
class DeclineReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        LiteService.send(context, Intent(LiteService.ACTION_DECLINE).putExtra("id", intent.getStringExtra("id")))
    }
}

/** Meldingskanalen en het tonen van meldingen. */
object Meldingen {
    const val CH_VERBINDING = "verbinding"
    const val CH_GESPREK = "gesprek"
    const val CH_BERICHTEN = "berichten"
    const val CH_OPROEPEN = "oproepen"
    private const val CALL_ID = 999_000
    private const val GROUP = "lite-berichten"
    private const val SUMMARY_ID = 2

    fun channels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_VERBINDING, "Verbinding op de achtergrond", NotificationManager.IMPORTANCE_MIN).apply {
            description = "Houdt Skitta Lite verbonden zodat je berichten en oproepen binnenkrijgt"
            setShowBadge(false)
        })
        nm.createNotificationChannel(NotificationChannel(CH_GESPREK, "Lopend gesprek", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Zolang je aan het bellen bent"
            setShowBadge(false)
        })
        fun sound(name: String) = android.net.Uri.parse("android.resource://${context.packageName}/raw/$name")
        nm.createNotificationChannel(NotificationChannel(CH_BERICHTEN, "Berichten", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Nieuwe berichten en gemiste oproepen"
        })
        nm.createNotificationChannel(NotificationChannel(CH_OPROEPEN, "Oproepen", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Als iemand je belt"
            setSound(
                sound("oproep"),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            )
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 600, 400, 600, 400, 600)
        })
    }

    /** Opent de instelling van alleen de melding "verbonden"; uitzetten = weg, verbinding blijft. */
    fun hideConnection(context: Context): PendingIntent {
        val intent = Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
            .putExtra(android.provider.Settings.EXTRA_CHANNEL_ID, CH_VERBINDING)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(context, 7, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun openApp(context: Context, c: Long, answer: Boolean = false): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("c", c)
            .putExtra("answer", answer)
        return PendingIntent.getActivity(context, c.toInt() * 2 + (if (answer) 1 else 0), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun message(context: Context, c: Long, title: String, list: List<String>) {
        val nm = context.getSystemService(NotificationManager::class.java)
        val style = Notification.InboxStyle()
        list.forEach { style.addLine(it) }
        val n = Notification.Builder(context, CH_BERICHTEN)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(context.getColor(R.color.icon_bg))
            .setContentTitle(title)
            .setContentText(list.lastOrNull() ?: "Nieuw bericht")
            .setStyle(if (list.size > 1) style else Notification.BigTextStyle().bigText(list.lastOrNull() ?: ""))
            .setNumber(list.size)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setGroup(GROUP)
            .setContentIntent(openApp(context, c))
            .build()
        runCatching { nm.notify(c.toInt(), n) }
        val summary = Notification.Builder(context, CH_BERICHTEN)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(context.getColor(R.color.icon_bg))
            .setContentTitle("Skitta Lite")
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
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.cancel(c.toInt())
        val left = nm.activeNotifications.count { it.notification.group == GROUP && it.id != c.toInt() && it.id != SUMMARY_ID }
        if (left == 0) nm.cancel(SUMMARY_ID)
    }

    fun clearAll(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        for (s in nm.activeNotifications) if (s.id != 1) nm.cancel(s.id)
    }

    @Volatile private var ringing = ""

    fun call(context: Context, name: String, video: Boolean, c: Long, id: String) {
        ringing = id
        val decline = PendingIntent.getBroadcast(
            context, 11, Intent(context, DeclineReceiver::class.java).putExtra("id", id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = Notification.Builder(context, CH_OPROEPEN)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(context.getColor(R.color.icon_bg))
            .setContentTitle(name)
            .setContentText(if (video) "wil met je videobellen" else "belt je")
            .setCategory(Notification.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(true)
            .setTimeoutAfter(50_000)
            .setContentIntent(openApp(context, c))
            .setFullScreenIntent(openApp(context, c), true)
            .addAction(Notification.Action.Builder(null, "Weigeren", decline).build())
            .addAction(Notification.Action.Builder(null, "Opnemen", openApp(context, c, true)).build())
            .build().apply { flags = flags or Notification.FLAG_INSISTENT }
        runCatching { context.getSystemService(NotificationManager::class.java).notify(CALL_ID, n) }
    }

    fun cancelCall(context: Context, id: String? = null) {
        if (id != null && id != ringing) return
        ringing = ""
        context.getSystemService(NotificationManager::class.java).cancel(CALL_ID)
    }
}
