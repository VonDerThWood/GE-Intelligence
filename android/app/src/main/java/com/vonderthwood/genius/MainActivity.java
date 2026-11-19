package com.vonderthwood.genius;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Quiet hours (Ben, 2026-10-18): notifications during the user's quiet
    // hours go to this channel, so they still appear in the shade but make
    // no sound and don't vibrate. Used by both the app (LocalNotifications)
    // and the background runner (channelId, see scripts/patch-capacitor.js).
    static final String QUIET_CHANNEL_ID = "genius_quiet";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugin (not an npm package), so it's registered here.
        registerPlugin(GeniusMonitorPlugin.class);
        super.onCreate(savedInstanceState);
        createQuietChannel();
        hideSystemBars();
    }

    // Full screen (Ben, 2026-11-18): the status and navigation bars sat on top
    // of pop-ups (the welcome tour title, the history progress line). Hide both;
    // a swipe from the edge shows them briefly, then they hide again.
    private void hideSystemBars() {
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        androidx.core.view.WindowInsetsControllerCompat c =
            androidx.core.view.WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars());
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars(); // returning from another app or a dialog brings the bars back
    }

    private void createQuietChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(QUIET_CHANNEL_ID) != null) return;
        // LOW importance: shown in the shade and status bar, no sound.
        NotificationChannel ch = new NotificationChannel(QUIET_CHANNEL_ID, "Quiet hours", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Alerts and digests that arrive during your GEnius quiet hours: no sound or vibration.");
        ch.setSound(null, null);
        ch.enableVibration(false);
        nm.createNotificationChannel(ch);
    }
}
