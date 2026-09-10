package org.classroomhub.display

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.util.Log
import com.sendspin.protocol.AudioBuffer
import com.sendspin.protocol.AudioPlayer
import com.sendspin.protocol.ClockSync
import com.sendspin.protocol.StreamFormat
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.min

/**
 * Android AudioTrack sink for the Sendspin JVM transport.
 *
 * The agent intentionally advertises only stereo 48 kHz / 16-bit PCM for the first production
 * implementation. That keeps codec decoding out of the kiosk process while still using Sendspin's
 * clock synchronization and timestamped jitter buffer. Additional codecs can be added after the
 * PCM path is physically validated on the supported TV hardware.
 */
class AndroidPcmSendspinPlayer(
    private val buffer: AudioBuffer,
    @Suppress("UNUSED_PARAMETER") private val clockSync: ClockSync,
) : AudioPlayer {
    companion object { private const val TAG = "ClassroomHubSendspin" }

    private val running = AtomicBoolean(false)
    @Volatile private var configured: StreamFormat? = null
    @Volatile private var track: AudioTrack? = null
    @Volatile private var worker: Thread? = null
    @Volatile private var gain: Float = 1.0f
    @Volatile private var droppedDecode: Long = 0

    override val isPlaying: Boolean
        get() = running.get() && track?.playState == AudioTrack.PLAYSTATE_PLAYING

    override val droppedDecodeFrames: Long
        get() = droppedDecode

    @Synchronized
    override fun configure(format: StreamFormat) {
        require(format.codec.equals("pcm", ignoreCase = true)) { "Only PCM Sendspin audio is enabled on Android kiosk clients" }
        require(format.sampleRate == 48_000 && format.channels == 2 && format.bitDepth == 16) {
            "Unsupported Sendspin PCM format ${format.sampleRate}Hz/${format.channels}ch/${format.bitDepth}bit"
        }
        stop()
        configured = format
        val minBytes = AudioTrack.getMinBufferSize(
            format.sampleRate,
            AudioFormat.CHANNEL_OUT_STEREO,
            AudioFormat.ENCODING_PCM_16BIT,
        ).coerceAtLeast(16_384)
        track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(format.sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(minBytes * 4)
            .build()
        track?.setVolume(gain)
        Log.i(TAG, "Configured native Sendspin PCM output: ${format.sampleRate}Hz stereo 16-bit")
    }

    @Synchronized
    override fun start() {
        if (running.get()) return
        val audio = track ?: return
        running.set(true)
        audio.play()
        worker = Thread({ playbackLoop() }, "ClassroomHub-Sendspin-Audio").apply {
            priority = Thread.MAX_PRIORITY
            start()
        }
    }

    private fun playbackLoop() {
        while (running.get()) {
            try {
                val chunk = buffer.poll()
                if (chunk == null) {
                    val delayMicros = buffer.nextChunkDelayMicros() ?: 5_000L
                    Thread.sleep(min(10L, (delayMicros / 1_000L).coerceAtLeast(1L)))
                    continue
                }
                val audio = track ?: break
                var offset = 0
                while (running.get() && offset < chunk.data.size) {
                    val written = audio.write(chunk.data, offset, chunk.data.size - offset, AudioTrack.WRITE_BLOCKING)
                    if (written <= 0) {
                        droppedDecode++
                        Log.w(TAG, "AudioTrack rejected Sendspin PCM frame: $written")
                        break
                    }
                    offset += written
                }
            } catch (interrupted: InterruptedException) {
                Thread.currentThread().interrupt()
                break
            } catch (error: Exception) {
                droppedDecode++
                Log.w(TAG, "Native Sendspin audio loop error", error)
                try { Thread.sleep(20) } catch (_: InterruptedException) { break }
            }
        }
    }

    override fun flush() {
        buffer.flush()
        try { track?.flush() } catch (_: Exception) {}
    }

    @Synchronized
    override fun stop() {
        running.set(false)
        worker?.interrupt()
        worker = null
        try { track?.pause() } catch (_: Exception) {}
        try { track?.flush() } catch (_: Exception) {}
        try { track?.stop() } catch (_: Exception) {}
        try { track?.release() } catch (_: Exception) {}
        track = null
        buffer.flush()
    }

    override fun transition(format: StreamFormat) {
        configure(format)
        start()
    }

    override fun setVolume(gain: Float) {
        this.gain = gain.coerceIn(0f, 1f)
        try { track?.setVolume(this.gain) } catch (_: Exception) {}
    }
}
