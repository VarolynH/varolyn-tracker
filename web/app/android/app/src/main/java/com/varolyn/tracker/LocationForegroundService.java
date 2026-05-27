package com.varolyn.tracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * LocationForegroundService — Unkillable GPS tracking service
 *
 * Runs as an Android Foreground Service with a persistent notification.
 * Android cannot kill foreground services without user explicitly stopping them.
 * Survives: app switch, browser close, screen lock, doze mode (with wakelock).
 *
 * Sends GPS coordinates to Varolyn server via HTTP POST every 5 seconds.
 */
public class LocationForegroundService extends Service {

    private static final String TAG = "VarolynGPS";
    private static final String CHANNEL_ID = "varolyn_tracking_channel";
    private static final int NOTIFICATION_ID = 9001;
    private static final long INTERVAL_MS = 5000;
    private static final String PREFS_NAME = "varolyn_tracker_prefs";

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private PowerManager.WakeLock wakeLock;
    private ExecutorService executor;

    private String serverUrl = "";
    private String sessionToken = "";
    private boolean isTracking = false;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "LocationForegroundService created");

        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        executor = Executors.newSingleThreadExecutor();

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "varolyn:gpswakelock");
        wakeLock.acquire();

        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();

            if ("STOP_TRACKING".equals(action)) {
                Log.i(TAG, "Stop tracking requested");
                stopTracking();
                stopForeground(true);
                stopSelf();
                return START_NOT_STICKY;
            }

            serverUrl = intent.getStringExtra("serverUrl");
            sessionToken = intent.getStringExtra("sessionToken");

            if (serverUrl != null && sessionToken != null) {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                prefs.edit()
                    .putString("serverUrl", serverUrl)
                    .putString("sessionToken", sessionToken)
                    .putBoolean("isTracking", true)
                    .apply();
            } else {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                serverUrl = prefs.getString("serverUrl", "");
                sessionToken = prefs.getString("sessionToken", "");
            }
        }

        if (serverUrl == null || serverUrl.isEmpty() || sessionToken == null || sessionToken.isEmpty()) {
            Log.e(TAG, "No server URL or session token, stopping");
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, buildNotification("Tracking your location..."));

        if (!isTracking) {
            startLocationUpdates();
        }

        return START_STICKY;
    }

    @SuppressWarnings("MissingPermission")
    private void startLocationUpdates() {
        LocationRequest request = new LocationRequest.Builder(INTERVAL_MS)
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            .setMinUpdateIntervalMillis(3000)
            .setMaxUpdateDelayMillis(INTERVAL_MS)
            .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location loc = result.getLastLocation();
                if (loc != null) {
                    Log.d(TAG, String.format("GPS: %.6f, %.6f acc=%.1fm spd=%.1f",
                        loc.getLatitude(), loc.getLongitude(), loc.getAccuracy(), loc.getSpeed()));

                    updateNotification(String.format("Live tracking — %.5f, %.5f",
                        loc.getLatitude(), loc.getLongitude()));

                    sendLocationToServer(loc);
                }
            }
        };

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
            isTracking = true;
            Log.i(TAG, "Location updates started, interval=" + INTERVAL_MS + "ms");
        } catch (SecurityException e) {
            Log.e(TAG, "No location permission", e);
            stopSelf();
        }
    }

    private void sendLocationToServer(Location loc) {
        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(serverUrl + "/api/location");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + sessionToken);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setDoOutput(true);

                String json = String.format(
                    "{\"lat\":%.8f,\"lng\":%.8f,\"accuracy\":%.2f,\"speed\":%.2f,\"heading\":%.2f,\"altitude\":%.2f,\"timestamp\":\"%s\",\"source\":\"native_foreground\"}",
                    loc.getLatitude(),
                    loc.getLongitude(),
                    loc.getAccuracy(),
                    loc.getSpeed(),
                    loc.getBearing(),
                    loc.getAltitude(),
                    new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                        .format(new java.util.Date(loc.getTime()))
                );

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(json.getBytes(StandardCharsets.UTF_8));
                }

                int code = conn.getResponseCode();
                if (code == 200 || code == 201) {
                    Log.d(TAG, "Location sent OK");
                } else {
                    Log.w(TAG, "Server response: " + code);
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to send location: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private void stopTracking() {
        isTracking = false;
        if (fusedClient != null && locationCallback != null) {
            fusedClient.removeLocationUpdates(locationCallback);
        }
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit().putBoolean("isTracking", false).apply();
        Log.i(TAG, "Tracking stopped");
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Varolyn Location Tracking",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows when Varolyn is tracking your location");
            channel.setShowBadge(false);

            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String text) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPending = PendingIntent.getActivity(this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stopIntent = new Intent(this, LocationForegroundService.class);
        stopIntent.setAction("STOP_TRACKING");
        PendingIntent stopPending = PendingIntent.getService(this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Varolyn Tracker")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(openPending)
            .addAction(android.R.drawable.ic_media_pause, "Stop Tracking", stopPending)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    private void updateNotification(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(NOTIFICATION_ID, buildNotification(text));
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "Service onDestroy");
        stopTracking();
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (executor != null) {
            executor.shutdownNow();
        }
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.w(TAG, "Task removed, rescheduling...");
        Intent restartIntent = new Intent(this, LocationForegroundService.class);
        restartIntent.putExtra("serverUrl", serverUrl);
        restartIntent.putExtra("sessionToken", sessionToken);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(restartIntent);
        } else {
            startService(restartIntent);
        }
        super.onTaskRemoved(rootIntent);
    }
}
