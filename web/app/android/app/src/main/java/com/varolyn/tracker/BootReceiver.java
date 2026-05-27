package com.varolyn.tracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

/**
 * BootReceiver — Restarts GPS tracking after device reboot.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "VarolynBoot";
    private static final String PREFS_NAME = "varolyn_tracker_prefs";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            Log.i(TAG, "Boot completed, checking if tracking was active...");

            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            boolean wasTracking = prefs.getBoolean("isTracking", false);
            String serverUrl = prefs.getString("serverUrl", "");
            String sessionToken = prefs.getString("sessionToken", "");

            if (wasTracking && !serverUrl.isEmpty() && !sessionToken.isEmpty()) {
                Log.i(TAG, "Restarting tracking service after boot");
                Intent serviceIntent = new Intent(context, LocationForegroundService.class);
                serviceIntent.putExtra("serverUrl", serverUrl);
                serviceIntent.putExtra("sessionToken", sessionToken);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent);
                } else {
                    context.startService(serviceIntent);
                }
            } else {
                Log.i(TAG, "No active tracking session to restore");
            }
        }
    }
}
