package nl.timvanbergen.skitta

import android.app.Activity
import android.app.AlertDialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Automatische updates. De app kijkt op skitta.timvanbergen.nl/download/android.json of er een nieuwere versie is,
 * downloadt die stil op de achtergrond en installeert hem zodra je de app wegzet,
 * zodat je nooit midden in het typen wordt onderbroken.
 */
object Updater {

    private const val LATEST = "https://skitta.timvanbergen.nl/download/android.json"
    private const val PREFS = "skitta-update"
    private const val CHECK_EVERY = 30 * 60 * 1000L
    private const val CHANNEL = "updates"

    private data class Release(val code: Long, val name: String, val notes: String, val url: String)

    @Volatile private var busy = false
    @Volatile private var ready: File? = null
    private var waitingForPermission: Release? = null

    fun currentCode(context: Context): Long =
        context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode

    fun currentName(context: Context): String =
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""

    /** Bij openen en terugkomen in de app: hooguit eens per half uur kijken. */
    fun checkQuietly(activity: Activity) {
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (System.currentTimeMillis() - prefs.getLong("checked", 0L) < CHECK_EVERY) return
        check(activity, manual = false)
    }

    /** Net bijgewerkt? Dan één keer melden welke versie het nu is. */
    fun justUpdated(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = currentCode(context)
        val before = prefs.getLong("seen", 0L)
        prefs.edit().putLong("seen", now).apply()
        return if (before in 1 until now) currentName(context) else null
    }

    fun check(activity: Activity, manual: Boolean) {
        if (busy) return
        busy = true
        Thread {
            val release = try {
                fetchLatest()
            } catch (_: Exception) {
                null
            }
            activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putLong("checked", System.currentTimeMillis()).apply()
            activity.runOnUiThread {
                busy = false
                if (activity.isFinishing) return@runOnUiThread
                when {
                    release == null -> if (manual) toast(activity, "Kon niet controleren op updates")
                    release.code > currentCode(activity) -> start(activity, release, manual)
                    manual -> toast(activity, "Je hebt de nieuwste versie (${currentName(activity)})")
                }
            }
        }.start()
    }

    /** Terug in de app na het geven van toestemming om te installeren: verder waar we waren. */
    fun resume(activity: Activity) {
        val release = waitingForPermission ?: return
        if (!activity.packageManager.canRequestPackageInstalls()) return
        waitingForPermission = null
        download(activity, release, installNow = true)
    }

    /** De app gaat naar de achtergrond: klaarstaande update nu installeren. */
    fun installIfReady(context: Context) {
        val file = ready ?: return
        ready = null
        Thread { runCatching { install(context, file) } }.start()
    }

    private fun fetchLatest(): Release? {
        val conn = URL(LATEST).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 10_000
            conn.readTimeout = 15_000
            conn.setRequestProperty("User-Agent", "SkittaApp")
            if (conn.responseCode != 200) return null
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val code = json.optLong("code", 0L).takeIf { it > 0 } ?: return null
            return Release(code, json.optString("name"), json.optString("notes").trim(), json.getString("url"))
        } finally {
            conn.disconnect()
        }
    }

    private fun start(activity: Activity, release: Release, manual: Boolean) {
        if (!activity.packageManager.canRequestPackageInstalls()) {
            // Eenmalig: Android vraagt of Skitta zijn eigen updates mag installeren. Daarna gaat het vanzelf.
            waitingForPermission = release
            AlertDialog.Builder(activity, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Automatisch bijwerken aanzetten")
                .setMessage("Er staat versie ${release.name} klaar. Zet in het volgende scherm \"Toestaan van deze bron\" aan; daarna werkt Skitta zichzelf voortaan vanzelf bij.")
                .setPositiveButton("Naar instellingen") { _, _ ->
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                }
                .setNegativeButton("Later") { _, _ -> waitingForPermission = null }
                .show()
            return
        }
        download(activity, release, installNow = manual)
    }

    private fun download(activity: Activity, release: Release, installNow: Boolean) {
        if (installNow) toast(activity, "Versie ${release.name} wordt gedownload…")
        Thread {
            val file = File(activity.cacheDir, "skitta-update.apk")
            val ok = try {
                val conn = URL(release.url).openConnection() as HttpURLConnection
                conn.instanceFollowRedirects = true
                conn.setRequestProperty("User-Agent", "SkittaApp")
                conn.connectTimeout = 15_000
                conn.readTimeout = 60_000
                conn.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
                conn.disconnect()
                true
            } catch (_: Exception) {
                false
            }
            activity.runOnUiThread {
                if (!ok) {
                    if (installNow) toast(activity, "Downloaden mislukt, probeer het later opnieuw")
                    return@runOnUiThread
                }
                if (installNow || activity.isFinishing) {
                    Thread { runCatching { install(activity, file) } }.start()
                } else {
                    ready = file
                    (activity as? MainActivity)?.updateReady(release.name)
                }
            }
        }.start()
    }

    private fun install(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            // Vanaf Android 12 zonder extra bevestiging (als Skitta zelf de vorige versie installeerde).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("skitta.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            val status = PendingIntent.getBroadcast(context, id, Intent(context, InstallReceiver::class.java), flags)
            session.commit(status.intentSender)
        }
    }

    /** Moet Android toch nog even bevestigen terwijl de app weg is: dan via een melding. */
    fun askViaNotification(context: Context, confirm: Intent) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Updates", NotificationManager.IMPORTANCE_DEFAULT))
        }
        val tap = PendingIntent.getActivity(context, 7, confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = android.app.Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setColor(context.getColor(R.color.launcher_bg))
            .setContentTitle("Nieuwe versie van Skitta")
            .setContentText("Tik om de update te installeren")
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        runCatching { manager.notify(7, notification) }
    }

    private fun toast(context: Context, text: String) = Toast.makeText(context, text, Toast.LENGTH_LONG).show()
}

/** Uitslag van de installatie; Android kan nog om een bevestiging vragen. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                // Alleen meteen tonen als de app open is; anders mag Android het scherm niet openen.
                val shown = MainActivity.inFront && runCatching {
                    context.startActivity(Intent(confirm).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }.isSuccess
                if (!shown) Updater.askViaNotification(context, confirm)
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()
                Toast.makeText(context, "Bijwerken mislukt${if (msg.isNotEmpty()) ": $msg" else ""}", Toast.LENGTH_LONG).show()
            }
        }
    }
}
