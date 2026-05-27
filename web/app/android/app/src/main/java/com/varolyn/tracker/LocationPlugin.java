package com.varolyn.tracker;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * LocationPlugin — Capacitor bridge for native GPS foreground service.
 *
 * JS calls:
 *   Capacitor.Plugins.VarolynLocation.startTracking({ serverUrl, sessionToken })
 *   Capacitor.Plugins.VarolynLocation.stopTracking()
 *   Capacitor.Plugins.VarolynLocation.getStatus()
 *   Capacitor.Plugins.VarolynLocation.requestBatteryOptimization()
 */
@CapacitorPlugin(
    name = "VarolynLocation",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        )
    }
)
public class LocationPlugin extends Plugin {

    private static final String TAG = "VarolynPlugin";
    private String pendingServerUrl = null;
    private String pendingSessionToken = null;

    @PluginMethod
    public void startTracking(PluginCall call) {
        String serverUrl = call.getString("serverUrl");
        String sessionToken = call.getString("sessionToken");

        if (serverUrl == null || sessionToken == null) {
            call.reject("serverUrl and sessionToken are required");
            return;
        }

        Log.i(TAG, "startTracking called, serverUrl=" + serverUrl);

        // Check location permission
        if (getPermissionState("location") != com.getcapacitor.PermissionState.GRANTED) {
            pendingServerUrl = serverUrl;
            pendingSessionToken = sessionToken;
            requestPermissionForAlias("location", call, "locationPermissionCallback");
            return;
        }

        doStartService(serverUrl, sessionToken);

        JSObject ret = new JSObject();
        ret.put("status", "started");
        ret.put("source", "native_foreground");
        call.resolve(ret);
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        if (getPermissionState("location") == com.getcapacitor.PermissionState.GRANTED) {
            Log.i(TAG, "Location permission granted");

            if (pendingServerUrl != null && pendingSessionToken != null) {
                doStartService(pendingServerUrl, pendingSessionToken);
                JSObject ret = new JSObject();
                ret.put("status", "started");
                ret.put("source", "native_foreground");
                call.resolve(ret);
            } else {
                call.resolve(new JSObject().put("status", "permission_granted"));
            }
        } else {
            Log.w(TAG, "Location permission denied");
            call.reject("Location permission denied by user");
        }
        pendingServerUrl = null;
        pendingSessionToken = null;
    }

    private void doStartService(String serverUrl, String sessionToken) {
        Intent intent = new Intent(getContext(), LocationForegroundService.class);
        intent.putExtra("serverUrl", serverUrl);
        intent.putExtra("sessionToken", sessionToken);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        Log.i(TAG, "Foreground service started");
    }

    @PluginMethod
    public void stopTracking(PluginCall call) {
        Intent intent = new Intent(getContext(), LocationForegroundService.class);
        intent.setAction("STOP_TRACKING");
        getContext().startService(intent);

        JSObject ret = new JSObject();
        ret.put("status", "stopped");
        call.resolve(ret);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("isNative", true);
        ret.put("platform", "android");
        ret.put("hasLocation", getPermissionState("location") == com.getcapacitor.PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestBatteryOptimization(PluginCall call) {
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getContext().getPackageName())) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);
            }
            JSObject ret = new JSObject();
            ret.put("requested", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Cannot request battery optimization: " + e.getMessage());
        }
    }
}
