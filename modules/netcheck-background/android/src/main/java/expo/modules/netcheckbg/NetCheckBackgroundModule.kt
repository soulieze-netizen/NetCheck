package expo.modules.netcheckbg

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.ScanResult
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address
import java.util.concurrent.atomic.AtomicBoolean

class NetCheckBackgroundModule : Module() {
  private val ctx: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("NetCheckBackground")

    // ---------- Service « écran éteint » ----------

    /** Démarre le service (à appeler appli ouverte). Renvoie false si Android refuse. */
    Function("start") { title: String, text: String ->
      val c = ctx
      if (c == null) {
        false
      } else {
        try {
          val intent = Intent(c, NetCheckService::class.java)
            .putExtra(NetCheckService.EXTRA_TITLE, title)
            .putExtra(NetCheckService.EXTRA_TEXT, text)
          if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(intent) else c.startService(intent)
          true
        } catch (e: Exception) {
          Log.w(NetCheckService.TAG, "Démarrage du service impossible", e)
          false
        }
      }
    }

    Function("update") { title: String, text: String ->
      val c = ctx
      if (c != null) {
        try {
          val manager = c.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
          manager.notify(NetCheckService.NOTIFICATION_ID, NetCheckService.buildNotification(c, title, text))
        } catch (_: Exception) {}
      }
    }

    Function("stop") {
      val c = ctx
      try {
        c?.stopService(Intent(c, NetCheckService::class.java))
      } catch (_: Exception) {}
      Unit
    }

    // ---------- Réseau ----------

    /** Adresse de la box (passerelle du réseau actuel), ex. « 192.168.0.1 » */
    Function("gateway") {
      gatewayOf(ctx)
    }

    Function("networkType") {
      networkTypeOf(ctx)
    }

    /** La localisation du téléphone est-elle activée ? (sinon Android ne donne pas les Wi-Fi voisins) */
    Function("locationEnabled") {
      val c = ctx
      if (c == null) {
        false
      } else {
        try {
          val lm = c.getSystemService(Context.LOCATION_SERVICE) as LocationManager
          if (Build.VERSION.SDK_INT >= 28) lm.isLocationEnabled
          else lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) || lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
        } catch (_: Exception) {
          false
        }
      }
    }

    /** Wi-Fi auquel le téléphone est connecté : force du signal, fréquence, vitesse de liaison… */
    Function("wifiInfo") {
      wifiInfoOf(ctx)
    }

    /** Liste des Wi-Fi visibles (le sien et ceux des voisins). Attend la fin du scan (max ~10 s). */
    AsyncFunction("scanWifi") { promise: Promise ->
      val c = ctx
      if (c == null) {
        promise.resolve(mapOf("ok" to false, "error" to "contexte", "fresh" to false, "results" to emptyList<Any>()))
        return@AsyncFunction
      }
      val wm = c.getSystemService(Context.WIFI_SERVICE) as WifiManager
      val done = AtomicBoolean(false)
      val handler = Handler(Looper.getMainLooper())
      var receiver: BroadcastReceiver? = null

      fun finish(fresh: Boolean) {
        if (!done.compareAndSet(false, true)) return
        try {
          receiver?.let { c.unregisterReceiver(it) }
        } catch (_: Exception) {}
        try {
          promise.resolve(mapOf("ok" to true, "fresh" to fresh, "results" to scanResultsOf(wm)))
        } catch (e: SecurityException) {
          promise.resolve(mapOf("ok" to false, "error" to "permission", "fresh" to false, "results" to emptyList<Any>()))
        } catch (e: Exception) {
          promise.resolve(mapOf("ok" to false, "error" to (e.message ?: "erreur"), "fresh" to false, "results" to emptyList<Any>()))
        }
      }

      receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          val updated = intent?.getBooleanExtra(WifiManager.EXTRA_RESULTS_UPDATED, true) ?: true
          finish(updated)
        }
      }
      try {
        val filter = IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION)
        if (Build.VERSION.SDK_INT >= 33) {
          c.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
          c.registerReceiver(receiver, filter)
        }
      } catch (_: Exception) {}

      val started = try {
        @Suppress("DEPRECATION")
        wm.startScan()
      } catch (_: Exception) {
        false
      }
      // Scan refusé (Android limite à 4 scans / 2 min) : on renvoie les derniers résultats connus
      if (!started) finish(false) else handler.postDelayed({ finish(false) }, 10000)
    }
  }

  companion object {
    fun networkTypeOf(c: Context?): String {
      if (c == null) return "other"
      return try {
        val cm = c.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val net = cm.activeNetwork ?: return "none"
        val caps = cm.getNetworkCapabilities(net) ?: return "none"
        when {
          caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
          caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
          caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
          else -> "other"
        }
      } catch (_: Exception) {
        "other"
      }
    }

    @Suppress("DEPRECATION")
    fun gatewayOf(c: Context?): String? {
      if (c == null) return null
      try {
        val cm = c.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val net = cm.activeNetwork
        val lp = if (net != null) cm.getLinkProperties(net) else null
        lp?.routes?.forEach { r ->
          val gw = r.gateway
          if (r.isDefaultRoute && gw is Inet4Address && !gw.isAnyLocalAddress) return gw.hostAddress
        }
      } catch (_: Exception) {}
      try {
        val wm = c.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val g = wm.dhcpInfo?.gateway ?: 0
        if (g != 0) return "${g and 0xff}.${(g shr 8) and 0xff}.${(g shr 16) and 0xff}.${(g shr 24) and 0xff}"
      } catch (_: Exception) {}
      return null
    }

    @Suppress("DEPRECATION")
    fun wifiInfoOf(c: Context?): Map<String, Any?>? {
      if (c == null) return null
      return try {
        val wm = c.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val i = wm.connectionInfo ?: return null
        if (i.networkId == -1 && i.rssi <= -127) return null
        val ssid = i.ssid?.removeSurrounding("\"")
        mapOf(
          "ssid" to if (ssid == null || ssid == WifiManager.UNKNOWN_SSID || ssid == "<unknown ssid>") null else ssid,
          "bssid" to if (i.bssid == null || i.bssid == "02:00:00:00:00:00") null else i.bssid,
          "rssi" to i.rssi,
          "frequency" to i.frequency,
          "linkSpeed" to i.linkSpeed,
          "txSpeed" to if (Build.VERSION.SDK_INT >= 29) i.txLinkSpeedMbps else null,
          "rxSpeed" to if (Build.VERSION.SDK_INT >= 29) i.rxLinkSpeedMbps else null,
          "standard" to if (Build.VERSION.SDK_INT >= 30) i.wifiStandard else null
        )
      } catch (_: Exception) {
        null
      }
    }

    @Suppress("DEPRECATION")
    fun scanResultsOf(wm: WifiManager): List<Map<String, Any?>> {
      val list: List<ScanResult> = wm.scanResults ?: emptyList()
      return list.map { r ->
        val width = when (r.channelWidth) {
          ScanResult.CHANNEL_WIDTH_20MHZ -> 20
          ScanResult.CHANNEL_WIDTH_40MHZ -> 40
          ScanResult.CHANNEL_WIDTH_80MHZ -> 80
          ScanResult.CHANNEL_WIDTH_160MHZ -> 160
          ScanResult.CHANNEL_WIDTH_80MHZ_PLUS_MHZ -> 160
          else -> 20
        }
        mapOf(
          "ssid" to (r.SSID ?: ""),
          "bssid" to r.BSSID,
          "level" to r.level,
          "frequency" to r.frequency,
          "center" to if (r.centerFreq0 > 0) r.centerFreq0 else r.frequency,
          "width" to width
        )
      }
    }
  }
}
