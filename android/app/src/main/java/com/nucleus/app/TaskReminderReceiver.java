package com.nucleus.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Pre-Notification Live Sync Guard:
 * Срабатывает по сигналу AlarmManager ровно за N минут до запланированной задачи.
 * ПЕРЕД выводом уведомления делает быстрый прямой сетевой запрос в Supabase REST API,
 * чтобы проверить, не была ли эта задача уже отмечена выполненной на ПК (или другом устройстве).
 *
 * Если задача уже выполнена (status == 'done' или 'skip') — уведомление ПОДАВЛЯЕТСЯ.
 * Если задача не выполнена — выводится громкое уведомление со звуком notify_sound.wav.
 * Если нет связи (оффлайн / таймаут) — выводится уведомление (fail-safe защита).
 */
public class TaskReminderReceiver extends BroadcastReceiver {
    private static final String TAG = "TaskReminder";
    public static final String CHANNEL_ID = "reminders";
    public static final String CHANNEL_NAME = "Напоминания";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        final PendingResult pendingResult = goAsync();
        new Thread(() -> {
            try {
                handleAlarm(context, intent);
            } catch (Exception e) {
                Log.e(TAG, "Error handling reminder alarm", e);
            } finally {
                pendingResult.finish();
            }
        }).start();
    }

    private void handleAlarm(Context context, Intent intent) {
        int notifId = intent.getIntExtra("notifId", 0);
        String type = intent.getStringExtra("type"); // "task" | "oneoff" | "water"
        String itemId = intent.getStringExtra("itemId");
        String date = intent.getStringExtra("date");
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        String path = intent.getStringExtra("path");
        String userId = intent.getStringExtra("userId");

        if (title == null) title = "Nucleus";
        if (body == null) body = "";
        if (path == null || path.isEmpty()) path = "/planner";

        Log.i(TAG, "Alarm fired for " + type + " (id=" + notifId + ", itemId=" + itemId + ")");

        // 1. Проверка для регулярных дел и привычек планировщика
        if ("task".equals(type) && itemId != null && !itemId.isEmpty()) {
            boolean alreadyDone = checkTaskAlreadyDone(context, userId, itemId, date);
            if (alreadyDone) {
                Log.i(TAG, "Task " + itemId + " is already done in Supabase! Suppressing notification.");
                // Удаляем это напоминание из списка активных в хранилище
                TaskReminderPlugin.removeSavedReminder(context, notifId);
                return;
            }
        }

        // 2. Проверка для разовых задач (planner_oneoff)
        if ("oneoff".equals(type) && itemId != null && !itemId.isEmpty()) {
            boolean alreadyDone = checkOneoffAlreadyDone(context, userId, itemId);
            if (alreadyDone) {
                Log.i(TAG, "Oneoff task " + itemId + " is already done in Supabase! Suppressing notification.");
                TaskReminderPlugin.removeSavedReminder(context, notifId);
                return;
            }
        }

        // 3. Выводим уведомление пользователю
        showNotification(context, notifId, title, body, path);
        TaskReminderPlugin.removeSavedReminder(context, notifId);
    }

    /**
     * Проверяет в Supabase REST API, выполнен ли пункт плана на эту дату.
     * Возвращает true, если статус 'done' или 'skip'.
     * При любой сетевой ошибке или таймауте возвращает false (fail-safe).
     */
    private boolean checkTaskAlreadyDone(Context context, String userId, String itemId, String date) {
        SharedPreferences prefs = context.getSharedPreferences(TaskReminderPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String supabaseUrl = prefs.getString("supabase_url", null);
        String anonKey = prefs.getString("supabase_anon_key", null);
        if (userId == null || userId.isEmpty()) {
            userId = prefs.getString("user_id", null);
        }

        if (supabaseUrl == null || anonKey == null || userId == null) {
            Log.w(TAG, "Missing Supabase credentials for task check, falling back to show notification");
            return false;
        }

        String token = getFreshAccessToken(context, supabaseUrl, anonKey);

        try {
            String endpoint = supabaseUrl + "/rest/v1/planner_logs?user_id=eq." + userId
                    + "&date=eq." + date + "&select=item_id,status";
            URL url = new URL(endpoint);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            conn.setRequestProperty("apikey", anonKey);
            if (token != null && !token.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + token);
            }
            conn.setRequestProperty("Accept", "application/json");

            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                String response = readStream(conn.getInputStream());
                JSONArray logs = new JSONArray(response);

                boolean targetDone = false;
                for (int i = 0; i < logs.length(); i++) {
                    JSONObject log = logs.getJSONObject(i);
                    String loggedItemId = log.optString("item_id");
                    String status = log.optString("status");

                    if ("done".equalsIgnoreCase(status) || "skip".equalsIgnoreCase(status)) {
                        if (itemId.equals(loggedItemId)) {
                            targetDone = true;
                        }
                        // Бонус: отменяем будущие будильники для других дел за сегодня,
                        // которые пользователь тоже уже отметил на ПК!
                        TaskReminderPlugin.cancelReminderByItemId(context, loggedItemId);
                    }
                }
                return targetDone;
            } else {
                Log.w(TAG, "Supabase returned HTTP " + code + " on planner_logs check");
            }
        } catch (Exception e) {
            Log.w(TAG, "Supabase check failed: " + e.getMessage() + ". Safe fallback: showing notification.");
        }
        return false;
    }

    /**
     * Проверяет в Supabase, завершена ли разовая задача (done_at != null).
     */
    private boolean checkOneoffAlreadyDone(Context context, String userId, String taskId) {
        SharedPreferences prefs = context.getSharedPreferences(TaskReminderPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String supabaseUrl = prefs.getString("supabase_url", null);
        String anonKey = prefs.getString("supabase_anon_key", null);

        if (supabaseUrl == null || anonKey == null) return false;
        String token = getFreshAccessToken(context, supabaseUrl, anonKey);

        try {
            String endpoint = supabaseUrl + "/rest/v1/planner_oneoff?id=eq." + taskId + "&select=done_at";
            URL url = new URL(endpoint);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            conn.setRequestProperty("apikey", anonKey);
            if (token != null && !token.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + token);
            }
            conn.setRequestProperty("Accept", "application/json");

            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                String response = readStream(conn.getInputStream());
                JSONArray tasks = new JSONArray(response);
                if (tasks.length() > 0) {
                    JSONObject t = tasks.getJSONObject(0);
                    String doneAt = t.optString("done_at", null);
                    if (doneAt != null && !doneAt.isEmpty() && !"null".equalsIgnoreCase(doneAt)) {
                        return true;
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Supabase check for oneoff failed: " + e.getMessage());
        }
        return false;
    }

    /**
     * Получает актуальный access_token из CapacitorStorage SharedPreferences.
     * Если токен истёк, автоматически делает refresh_token запрос к Supabase Auth.
     */
    private String getFreshAccessToken(Context context, String supabaseUrl, String anonKey) {
        SharedPreferences storage = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String savedToken = null;
        String refreshToken = null;
        long expiresAt = 0;
        String authKeyFound = null;

        for (String key : storage.getAll().keySet()) {
            if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
                String raw = storage.getString(key, null);
                if (raw != null && raw.startsWith("{")) {
                    try {
                        JSONObject json = new JSONObject(raw);
                        savedToken = json.optString("access_token", null);
                        refreshToken = json.optString("refresh_token", null);
                        expiresAt = json.optLong("expires_at", 0);
                        authKeyFound = key;
                        break;
                    } catch (Exception ignored) {}
                }
            }
        }

        // Если токена нет в CapacitorStorage, проверяем наш TaskReminderPrefs
        if (savedToken == null) {
            SharedPreferences myPrefs = context.getSharedPreferences(TaskReminderPlugin.PREFS_NAME, Context.MODE_PRIVATE);
            savedToken = myPrefs.getString("access_token", null);
        }

        // Проверяем срок действия токена (с запасом 60 секунд)
        long nowSec = System.currentTimeMillis() / 1000;
        if (expiresAt > 0 && expiresAt <= (nowSec + 60) && refreshToken != null && !refreshToken.isEmpty()) {
            Log.i(TAG, "Access token expired, attempting background refresh...");
            String refreshed = refreshAccessToken(supabaseUrl, anonKey, refreshToken);
            if (refreshed != null) {
                savedToken = refreshed;
            }
        }

        return savedToken;
    }

    /**
     * Фоновое обновление access_token через Supabase Auth endpoint
     */
    private String refreshAccessToken(String supabaseUrl, String anonKey, String refreshToken) {
        try {
            URL url = new URL(supabaseUrl + "/auth/v1/token?grant_type=refresh_token");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            conn.setRequestProperty("apikey", anonKey);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);

            JSONObject body = new JSONObject();
            body.put("refresh_token", refreshToken);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }

            if (conn.getResponseCode() == 200) {
                String resp = readStream(conn.getInputStream());
                JSONObject json = new JSONObject(resp);
                return json.optString("access_token", null);
            }
        } catch (Exception e) {
            Log.w(TAG, "Token refresh failed: " + e.getMessage());
        }
        return null;
    }

    private String readStream(InputStream is) throws Exception {
        BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line);
        }
        reader.close();
        return sb.toString();
    }

    /**
     * Показывает уведомление в шторке с нашим звуком и каналом.
     */
    public static void showNotification(Context context, int notifId, String title, String body, String path) {
        ensureChannel(context);

        String cleanPath = (path != null && path.startsWith("/")) ? path.substring(1) : (path != null ? path : "planner");
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("com.nucleus.app://" + cleanPath));
        open.setPackage(context.getPackageName());
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        open.putExtra("notification_route", path);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentPi = PendingIntent.getActivity(context, notifId, open, flags);

        Uri soundUri = Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.notify_sound);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_focus)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setSound(soundUri)
                .setContentIntent(contentPi);

        NotificationManagerCompat nm = NotificationManagerCompat.from(context);
        try {
            nm.notify(notifId, builder.build());
            Log.i(TAG, "Notification successfully posted (id=" + notifId + ")");
        } catch (SecurityException se) {
            Log.e(TAG, "Cannot post notification: missing permission", se);
        }
    }

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        CHANNEL_NAME,
                        NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Напоминания о делах и воде");
                channel.enableVibration(true);

                Uri soundUri = Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.notify_sound);
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .build();
                channel.setSound(soundUri, audioAttributes);
                nm.createNotificationChannel(channel);
            }
        }
    }
}
