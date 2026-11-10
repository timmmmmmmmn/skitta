package nl.timvanbergen.skitta

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import java.io.File

/**
 * De eigen videospeler van de app (Media3/ExoPlayer): volledig scherm, draaien naar liggend, de
 * bekende Android-bediening. De video is al ontsleuteld door de pagina en staat tijdelijk in de
 * eigen cache van de app; bij sluiten wordt hij meteen verwijderd.
 */
@UnstableApi
class VideoActivity : ComponentActivity() {

    private var player: ExoPlayer? = null
    private var file: File? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (getSharedPreferences("skitta", Context.MODE_PRIVATE).getBoolean("secure", false)) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        val path = intent.getStringExtra("path")
        val streamUrl = intent.getStringExtra("url")
        if (path == null && streamUrl == null) return finish()
        file = path?.let { File(it) }
        val view = PlayerView(this).apply {
            setShowNextButton(false)
            setShowPreviousButton(false)
            // Volledig scherm = liggend draaien; nog een keer = terug naar hoe de telefoon staat.
            setFullscreenButtonClickListener { full ->
                requestedOrientation = if (full) android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                else android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
            keepScreenOn = true
        }
        setContentView(view)
        val exo = ExoPlayer.Builder(this).build()
        if (streamUrl != null) {
            // Streamen: stukken ophalen en ontsleutelen terwijl je kijkt.
            val key = android.util.Base64.decode(intent.getStringExtra("key"), android.util.Base64.DEFAULT)
            val factory = EncryptedVideoSource.Factory(streamUrl, intent.getStringExtra("token") ?: "", key, intent.getLongExtra("size", 0L))
            exo.setMediaSource(
                androidx.media3.exoplayer.source.ProgressiveMediaSource.Factory(factory)
                    .createMediaSource(MediaItem.Builder().setUri(Uri.parse("skitta://video")).setMimeType(intent.getStringExtra("mime")).build())
            )
        } else {
            exo.setMediaItem(MediaItem.Builder().setUri(Uri.fromFile(file)).setMimeType(intent.getStringExtra("mime")).build())
        }
        exo.playWhenReady = true
        exo.prepare()
        view.player = exo
        player = exo
        title = intent.getStringExtra("title") ?: "Video"
    }

    override fun onStop() {
        super.onStop()
        player?.pause()
    }

    override fun onDestroy() {
        player?.release()
        player = null
        if (isFinishing) file?.delete()
        super.onDestroy()
    }

    companion object {
        fun dir(context: Context) = File(context.cacheDir, "video").apply { mkdirs() }

        @androidx.annotation.OptIn(UnstableApi::class)
        fun stream(context: Context, url: String, token: String, key: String, size: Long, mime: String, title: String) {
            context.startActivity(
                Intent(context, VideoActivity::class.java)
                    .putExtra("url", url).putExtra("token", token).putExtra("key", key).putExtra("size", size)
                    .putExtra("mime", mime).putExtra("title", title)
            )
        }

        @androidx.annotation.OptIn(UnstableApi::class)
        fun start(context: Context, file: File, mime: String, title: String) {
            context.startActivity(
                Intent(context, VideoActivity::class.java)
                    .putExtra("path", file.absolutePath).putExtra("mime", mime).putExtra("title", title)
            )
        }
    }
}
