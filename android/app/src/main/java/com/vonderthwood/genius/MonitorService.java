package com.vonderthwood.genius;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import io.ionic.backgroundrunner.plugin.RunnerWorker;

/**
 * "Live monitoring" (Ben, 2026-10-15): an optional foreground service that
 * runs GEnius's background check (mobile/runners/background.js: price
 * alerts, watchlist + portfolio digests, DXP, reminders) on the user's fetch
 * interval, instead of whenever WorkManager's battery-saving schedule gets
 * to it (1-4h apart on Ben's phone, longer with Battery Saver on).
 *
 * It triggers the background runner rather than the app's own web page:
 * tested on Ben's Pixel 8 Pro (Android 16), the WebView page is fully
 * frozen while GEnius is off screen (timers and network callbacks never
 * run, even with this service keeping the process alive), so the page's
 * own 15-minute fetch can't be relied on in the background.
 *
 * The notification lives in its own MIN-importance channel so it's silent
 * and can be hidden in Android's notification settings without muting
 * GEnius's real alert notifications.
 */
public class MonitorService extends Service {
    static final String CHANNEL_ID = "genius_live_monitoring";
    static final int NOTIFICATION_ID = 4210;
    static final String EXTRA_INTERVAL_MIN = "intervalMinutes";
    // Must match capacitor.config.ts's BackgroundRunner section.
    static final String RUNNER_LABEL = "com.vonderthwood.genius.background.task";
    static final String RUNNER_SRC = "runners/background.js";
    static final String RUNNER_EVENT = "checkNotifications";
    static volatile boolean running = false;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private long intervalMs = 15 * 60 * 1000L;
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            runBackgroundCheck();
            handler.postDelayed(this, intervalMs);
        }
    };

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Live monitoring", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Shown while GEnius keeps checking prices in the background. Safe to hide; price alerts use a separate channel.");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification n = new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("GEnius is monitoring prices")
            .setContentText("Checking prices and alerts on your fetch schedule")
            .setContentIntent(pi)
            .setOngoing(true)
            .build();

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }

        int minutes = intent != null ? intent.getIntExtra(EXTRA_INTERVAL_MIN, 15) : 15;
        intervalMs = Math.max(5, minutes) * 60 * 1000L;
        // (Re)start the timer: first check one interval from now (the app
        // has just fetched if it's open), then every interval after.
        handler.removeCallbacks(tick);
        handler.postDelayed(tick, intervalMs);

        running = true;
        // Not sticky: if Android or the user kills GEnius, it comes back the
        // next time the app is opened (bridge.js restarts it when enabled).
        return START_NOT_STICKY;
    }

    // Same job WorkManager's periodic schedule runs, enqueued to run now.
    private void runBackgroundCheck() {
        Data data = new Data.Builder()
            .putString("label", RUNNER_LABEL)
            .putString("src", RUNNER_SRC)
            .putString("event", RUNNER_EVENT)
            .build();
        OneTimeWorkRequest work = new OneTimeWorkRequest.Builder(RunnerWorker.class)
            .setInputData(data)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        WorkManager.getInstance(getApplicationContext())
            .enqueueUniqueWork("genius-live-monitoring-check", ExistingWorkPolicy.KEEP, work);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(tick);
        running = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
