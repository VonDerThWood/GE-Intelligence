package com.vonderthwood.genius;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** JS side: start/stop the Live monitoring foreground service (MonitorService). */
@CapacitorPlugin(name = "GeniusMonitor")
public class GeniusMonitorPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Intent i = new Intent(getContext(), MonitorService.class);
        i.putExtra(MonitorService.EXTRA_INTERVAL_MIN, call.getInt("intervalMinutes", 15));
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(i);
            else getContext().startService(i);
            call.resolve(status());
        } catch (Exception e) {
            call.reject("Couldn't start live monitoring: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), MonitorService.class));
        MonitorService.running = false;
        call.resolve(status());
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        call.resolve(status());
    }

    private JSObject status() {
        JSObject r = new JSObject();
        r.put("running", MonitorService.running);
        return r;
    }
}
