package expo.modules.netcheckbg

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Service de premier plan « NetCheck surveille… » : tant qu'il tourne, Android garde le
 * processeur et le Wi-Fi éveillés, et la tâche JS « NetCheckKeepAlive » reste ouverte :
 * la mesure continue écran éteint.
 */
class NetCheckService : HeadlessJsTaskService() {
  private var cpuLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "NetCheck"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    val notification = buildNotification(this, title, text)
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      Log.w(TAG, "startForeground impossible", e)
      stopSelf()
      return START_NOT_STICKY
    }
    acquireLocks()
    super.onStartCommand(intent, flags, startId)
    return START_NOT_STICKY
  }

  @SuppressLint("WakelockTimeout")
  @Suppress("DEPRECATION")
  private fun acquireLocks() {
    try {
      if (cpuLock == null) {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        cpuLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NetCheck:cpu").apply {
          setReferenceCounted(false)
          acquire()
        }
      }
      if (wifiLock == null) {
        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "NetCheck:wifi").apply {
          setReferenceCounted(false)
          acquire()
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Verrous impossibles", e)
    }
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), 0, true)

  override fun onDestroy() {
    try {
      cpuLock?.let { if (it.isHeld) it.release() }
      wifiLock?.let { if (it.isHeld) it.release() }
    } catch (_: Exception) {}
    cpuLock = null
    wifiLock = null
    if (Build.VERSION.SDK_INT >= 24) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }

  companion object {
    const val TAG = "NetCheckService"
    const val TASK_KEY = "NetCheckKeepAlive"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val NOTIFICATION_ID = 5311
    private const val CHANNEL_ID = "netcheck_watch"

    fun buildNotification(ctx: Context, title: String, text: String): Notification {
      val manager = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= 26) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Surveillance de la connexion", NotificationManager.IMPORTANCE_LOW)
        )
      }
      val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      val pending = launch?.let {
        PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }
      val builder = if (Build.VERSION.SDK_INT >= 26) {
        Notification.Builder(ctx, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(ctx)
      }
      builder
        .setContentTitle(title)
        .setContentText(text)
        .setSmallIcon(android.R.drawable.stat_notify_sync)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
      if (pending != null) builder.setContentIntent(pending)
      if (Build.VERSION.SDK_INT >= 31) {
        builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
      }
      return builder.build()
    }
  }
}
