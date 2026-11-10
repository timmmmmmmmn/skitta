package nl.timvanbergen.skitta

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Streamt een versleutelde video van de Skitta-bestandsserver, zoals Signal: alleen de stukken die de
 * speler nodig heeft worden opgehaald (HTTP Range) en ontsleuteld, het volgende stuk alvast op de
 * achtergrond. Zo begint de video meteen en kun je doorspoelen.
 * Opbouw van het bestand: stukken van 4 MB, elk iv (12) + versleutelde inhoud + tag (16), AES-256-GCM.
 */
@UnstableApi
class EncryptedVideoSource(
    private val url: String,
    private val token: String,
    key: ByteArray,
    private val plainSize: Long,
) : BaseDataSource(true) {

    private val key = SecretKeySpec(key, "AES")
    private val encSize = plainSize + ((plainSize + CHUNK - 1) / CHUNK) * 28
    private var uri: Uri? = null
    private var position = 0L
    private var remaining = 0L

    override fun open(dataSpec: DataSpec): Long {
        uri = dataSpec.uri
        transferInitializing(dataSpec)
        position = dataSpec.position
        if (position > plainSize) throw IOException("buiten de video")
        remaining = if (dataSpec.length != C.LENGTH_UNSET.toLong()) dataSpec.length else plainSize - position
        transferStarted(dataSpec)
        return remaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (remaining <= 0) return C.RESULT_END_OF_INPUT
        val index = position / CHUNK
        val plain = chunk(index)
        prefetch(index + 1)
        val inChunk = (position - index * CHUNK).toInt()
        val n = minOf(length.toLong(), remaining, (plain.size - inChunk).toLong()).toInt()
        if (n <= 0) return C.RESULT_END_OF_INPUT
        System.arraycopy(plain, inChunk, buffer, offset, n)
        position += n
        remaining -= n
        bytesTransferred(n)
        return n
    }

    override fun getUri(): Uri? = uri

    override fun close() {
        if (uri != null) transferEnded()
        uri = null
    }

    private fun chunk(index: Long): ByteArray {
        val f = cache[cacheKey(index)] ?: fetchAsync(index)
        return try {
            f.get(60, TimeUnit.SECONDS)
        } catch (e: Exception) {
            cache.remove(cacheKey(index))
            throw IOException("stuk $index kon niet worden geladen", e)
        }
    }

    private fun prefetch(index: Long) {
        if (index * CHUNK < plainSize && !cache.containsKey(cacheKey(index))) fetchAsync(index)
    }

    private fun cacheKey(index: Long) = "$url#$index"

    private fun fetchAsync(index: Long): Future<ByteArray> {
        val f = pool.submit<ByteArray> { fetch(index) }
        cache[cacheKey(index)] = f
        // Hooguit een paar stukken in het geheugen.
        if (cache.size > 6) cache.keys.firstOrNull { it.startsWith("$url#") && it != cacheKey(index) }?.let { cache.remove(it) }
        return f
    }

    private fun fetch(index: Long): ByteArray {
        val from = index * ENC
        val to = minOf(from + ENC, encSize) - 1
        val req = Request.Builder().url(url).header("Authorization", "Bearer $token").header("Range", "bytes=$from-$to").build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw IOException("HTTP ${res.code}")
            val bytes = res.body!!.bytes()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes, 0, 12))
            return cipher.doFinal(bytes, 12, bytes.size - 12)
        }
    }

    class Factory(private val url: String, private val token: String, private val key: ByteArray, private val size: Long) : DataSource.Factory {
        override fun createDataSource(): DataSource = EncryptedVideoSource(url, token, key, size)
    }

    companion object {
        const val CHUNK = 4L * 1024 * 1024
        const val ENC = CHUNK + 28
        private val http = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
        private val pool = Executors.newFixedThreadPool(2)
        private val cache = ConcurrentHashMap<String, Future<ByteArray>>()
    }
}
