package org.classroomhub.display

import android.content.Context
import android.os.Build
import android.util.Log
import com.sendspin.protocol.AudioFormat
import com.sendspin.protocol.ClientPreferences
import com.sendspin.protocol.ClientSettingsStore
import com.sendspin.protocol.OptionalRole
import com.sendspin.protocol.SendSpinClient
import com.squareup.moshi.Moshi
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Native/background Sendspin player owned by AgentService, independent of the kiosk WebView. */
object NativeSendspinManager {
    private const val TAG = "ClassroomHubSendspin"
    private const val PREF_ENABLED = "sendspin_enabled"
    private const val PREF_URL = "sendspin_url"
    private const val PREF_NAME = "sendspin_name"
    private const val PREF_CLIENT_ID = "sendspin_client_id"

    @Volatile private var client: SendSpinClient? = null
    @Volatile private var activeUrl: String = ""
    @Volatile private var lastError: String = ""

    private class PrefStore(private val context: Context) : ClientSettingsStore {
        private val prefs get() = HubStorage.prefs(context)
        override fun getInt(key: String, default: Int): Int = prefs.getInt("sendspin.$key", default)
        override fun putInt(key: String, value: Int) { prefs.edit().putInt("sendspin.$key", value).apply() }
        override fun getString(key: String, default: String?): String? = prefs.getString("sendspin.$key", default)
        override fun putString(key: String, value: String) { prefs.edit().putString("sendspin.$key", value).apply() }
    }

    @Synchronized
    fun ensureStarted(context: Context) {
        val prefs = HubStorage.prefs(context)
        if (!prefs.getBoolean(PREF_ENABLED, false)) {
            stop("disabled")
            return
        }
        val url = prefs.getString(PREF_URL, "")?.trim().orEmpty()
        if (!(url.startsWith("ws://") || url.startsWith("wss://"))) {
            lastError = "Sendspin URL is not configured"
            return
        }
        if (client != null && activeUrl == url) return
        connect(context.applicationContext, url)
    }

    @Synchronized
    private fun connect(context: Context, url: String) {
        stop("reconfigure")
        try {
            val prefs = HubStorage.prefs(context)
            var clientId = prefs.getString(PREF_CLIENT_ID, "")?.trim().orEmpty()
            if (clientId.isEmpty()) {
                clientId = UUID.randomUUID().toString()
                prefs.edit().putString(PREF_CLIENT_ID, clientId).apply()
            }
            val name = prefs.getString(PREF_NAME, "")?.trim().takeUnless { it.isNullOrEmpty() }
                ?: "RoomGoblin ${Build.MODEL}"
            val preferences = ClientPreferences(
                supportedFormats = listOf(AudioFormat("pcm", 2, 48_000, 16)),
                artworkChannels = emptyList(),
                visualizerSupport = null,
                playerBufferCapacity = 262_144,
                playerSupportedCommands = listOf("volume", "mute"),
                supportedOptionalRoles = setOf(OptionalRole.PLAYER),
            )
            val http = OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .pingInterval(15, TimeUnit.SECONDS)
                .build()
            val created = SendSpinClient(
                okHttpClient = http,
                moshi = Moshi.Builder().build(),
                preferences = preferences,
                clientId = clientId,
                clientName = name,
                manufacturer = Build.MANUFACTURER,
                productName = Build.MODEL,
                softwareVersion = BuildConfig.VERSION_NAME,
                audioPlayerFactory = { audioBuffer, clockSync -> AndroidPcmSendspinPlayer(audioBuffer, clockSync) },
                settingsStore = PrefStore(context),
            )
            client = created
            activeUrl = url
            lastError = ""
            created.connect(url)
            Log.i(TAG, "Native Sendspin connection started for $name")
        } catch (error: Exception) {
            client = null
            activeUrl = ""
            lastError = error.message ?: error.javaClass.simpleName
            Log.e(TAG, "Unable to start native Sendspin player", error)
        }
    }

    @Synchronized
    fun configure(context: Context, enabled: Boolean, url: String?, name: String?): JSONObject {
        val cleanUrl = url?.trim().orEmpty()
        if (enabled && !(cleanUrl.startsWith("ws://") || cleanUrl.startsWith("wss://"))) {
            throw IllegalArgumentException("sendspinUrl must be ws:// or wss:// when native Sendspin is enabled")
        }
        val edit = HubStorage.prefs(context).edit().putBoolean(PREF_ENABLED, enabled)
        if (url != null) edit.putString(PREF_URL, cleanUrl)
        if (name != null) edit.putString(PREF_NAME, name.trim())
        edit.apply()
        if (enabled) ensureStarted(context) else stop("disabled")
        return status(context)
    }

    @Synchronized
    fun reconnect(context: Context): JSONObject {
        val prefs = HubStorage.prefs(context)
        val url = prefs.getString(PREF_URL, "")?.trim().orEmpty()
        stop("manual-reconnect")
        if (prefs.getBoolean(PREF_ENABLED, false) && url.isNotEmpty()) connect(context.applicationContext, url)
        return status(context)
    }

    @Synchronized
    fun stop(reason: String) {
        try { client?.disconnect(reason) } catch (_: Exception) {}
        client = null
        activeUrl = ""
    }

    fun status(context: Context): JSONObject {
        val prefs = HubStorage.prefs(context)
        val c = client
        val out = JSONObject()
        out.put("enabled", prefs.getBoolean(PREF_ENABLED, false))
        out.put("configured", !prefs.getString(PREF_URL, "").isNullOrBlank())
        out.put("url", prefs.getString(PREF_URL, ""))
        out.put("name", prefs.getString(PREF_NAME, ""))
        out.put("connected", c != null && c.state.value.name !in setOf("IDLE", "DISCONNECTED", "ERROR"))
        out.put("state", c?.state?.value?.name ?: "STOPPED")
        out.put("serverName", c?.serverName?.value ?: "")
        out.put("playing", c?.audioPlayer?.isPlaying ?: false)
        out.put("bufferedChunks", c?.audioBuffer?.size ?: 0)
        out.put("droppedChunks", c?.audioBuffer?.droppedChunks ?: 0)
        out.put("lateChunks", c?.audioBuffer?.lateChunks ?: 0)
        out.put("droppedDecodeFrames", c?.audioPlayer?.droppedDecodeFrames ?: 0)
        out.put("lastError", lastError)
        out.put("transport", "native-sendspin-jvm")
        out.put("format", "pcm/48000/2/16")
        return out
    }
}
