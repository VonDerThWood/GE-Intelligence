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
