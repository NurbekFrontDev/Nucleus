package com.nucleus.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Нативный Capacitor плагин для точного планирования напоминаний с
 * Pre-Notification Live Sync защитой от ложных срабатываний.
 */
@CapacitorPlugin(name = "TaskReminder")
public class TaskReminderPlugin extends Plugin {
    public static final String TAG = "TaskReminderPlugin";
    public static final String PREFS_NAME = "TaskReminderPrefs";
    private static final String KEY_ACTIVE_REMINDERS = "active_reminders";

    @PluginMethod
    public void scheduleReminders(PluginCall call) {
        try {
            Context context = getContext();
            String supabaseUrl = call.getString("supabaseUrl");
            String supabaseAnonKey = call.getString("supabaseAnonKey");
            String userId = call.getString("userId");
            String accessToken = call.getString("accessToken");

            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            if (supabaseUrl != null) editor.putString("supabase_url", supabaseUrl);
            if (supabaseAnonKey != null) editor.putString("supabase_anon_key", supabaseAnonKey);
            if (userId != null) editor.putString("user_id", userId);
            if (accessToken != null) editor.putString("access_token", accessToken);
            editor.apply();

            JSArray remindersArr = call.getArray("reminders");
            if (remindersArr == null) {
                call.resolve();
                return;
            }

            // Отменяем старые будильники перед установкой новых
            cancelAllAlarms(context);

            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            long now = System.currentTimeMillis();
            JSONArray savedList = new JSONArray();

            for (int i = 0; i < remindersArr.length(); i++) {
                JSONObject item = remindersArr.getJSONObject(i);
                int notifId = item.optInt("id", 0);
                long triggerAt = item.optLong("triggerAt", 0);
                String type = item.optString("type", "task");
                String itemId = item.optString("itemId", "");
                String date = item.optString("date", "");
                String title = item.optString("title", "Nucleus");
                String body = item.optString("body", "");
                String path = item.optString("path", "/planner");

                if (notifId == 0 || triggerAt <= now) {
                    continue;
                }

                Intent intent = new Intent(context, TaskReminderReceiver.class);
                intent.putExtra("notifId", notifId);
                intent.putExtra("type", type);
                intent.putExtra("itemId", itemId);
                intent.putExtra("date", date);
                intent.putExtra("title", title);
                intent.putExtra("body", body);
                intent.putExtra("path", path);
                intent.putExtra("userId", userId);

                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    flags |= PendingIntent.FLAG_IMMUTABLE;
                }
                PendingIntent pi = PendingIntent.getBroadcast(context, notifId, intent, flags);

                if (am != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                    } else {
                        am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                    }
                }

                savedList.put(item);
            }

            prefs.edit().putString(KEY_ACTIVE_REMINDERS, savedList.toString()).apply();
            Log.i(TAG, "Scheduled " + savedList.length() + " alarms successfully");

            JSObject res = new JSObject();
            res.put("count", savedList.length());
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "Failed to schedule reminders", e);
            call.reject("Failed to schedule reminders: " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancelReminder(PluginCall call) {
        try {
            Context context = getContext();
            Integer id = call.getInt("id", null);
            String itemId = call.getString("itemId", null);

            if (id != null) {
                cancelAlarmById(context, id);
                removeSavedReminder(context, id);
            }
            if (itemId != null) {
                cancelReminderByItemId(context, itemId);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        try {
            cancelAllAlarms(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    public static void cancelAlarmById(Context context, int notifId) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent intent = new Intent(context, TaskReminderReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getBroadcast(context, notifId, intent, flags);
        am.cancel(pi);
        pi.cancel();
        Log.i(TAG, "Cancelled alarm id=" + notifId);
    }

    public static void cancelReminderByItemId(Context context, String itemId) {
        if (itemId == null || itemId.isEmpty()) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_ACTIVE_REMINDERS, null);
        if (raw == null) return;

        try {
            JSONArray arr = new JSONArray(raw);
            JSONArray updated = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                String itemObjId = obj.optString("itemId");
                if (itemId.equals(itemObjId)) {
                    int notifId = obj.optInt("id", 0);
                    cancelAlarmById(context, notifId);
                } else {
                    updated.put(obj);
                }
            }
            prefs.edit().putString(KEY_ACTIVE_REMINDERS, updated.toString()).apply();
        } catch (Exception ignored) {}
    }

    public static void removeSavedReminder(Context context, int notifId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_ACTIVE_REMINDERS, null);
        if (raw == null) return;

        try {
            JSONArray arr = new JSONArray(raw);
            JSONArray updated = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                if (obj.optInt("id", 0) != notifId) {
                    updated.put(obj);
                }
            }
            prefs.edit().putString(KEY_ACTIVE_REMINDERS, updated.toString()).apply();
        } catch (Exception ignored) {}
    }

    public static void cancelAllAlarms(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_ACTIVE_REMINDERS, null);
        if (raw != null) {
            try {
                JSONArray arr = new JSONArray(raw);
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject obj = arr.getJSONObject(i);
                    int notifId = obj.optInt("id", 0);
                    if (notifId > 0) {
                        cancelAlarmById(context, notifId);
                    }
                }
            } catch (Exception ignored) {}
        }
        prefs.edit().remove(KEY_ACTIVE_REMINDERS).apply();
    }

    /**
     * Восстанавливает будильники после перезагрузки телефона.
     */
    public static void restoreAllReminders(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_ACTIVE_REMINDERS, null);
        if (raw == null) return;

        String userId = prefs.getString("user_id", null);
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        long now = System.currentTimeMillis();
        try {
            JSONArray arr = new JSONArray(raw);
            JSONArray stillValid = new JSONArray();

            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.getJSONObject(i);
                int notifId = item.optInt("id", 0);
                long triggerAt = item.optLong("triggerAt", 0);

                if (triggerAt <= now || notifId == 0) continue;

                Intent intent = new Intent(context, TaskReminderReceiver.class);
                intent.putExtra("notifId", notifId);
                intent.putExtra("type", item.optString("type", "task"));
                intent.putExtra("itemId", item.optString("itemId", ""));
                intent.putExtra("date", item.optString("date", ""));
                intent.putExtra("title", item.optString("title", "Nucleus"));
                intent.putExtra("body", item.optString("body", ""));
                intent.putExtra("path", item.optString("path", "/planner"));
                intent.putExtra("userId", userId);

                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    flags |= PendingIntent.FLAG_IMMUTABLE;
                }
                PendingIntent pi = PendingIntent.getBroadcast(context, notifId, intent, flags);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                }
                stillValid.put(item);
            }

            prefs.edit().putString(KEY_ACTIVE_REMINDERS, stillValid.toString()).apply();
            Log.i(TAG, "Restored " + stillValid.length() + " alarms after reboot");
        } catch (Exception e) {
            Log.e(TAG, "Failed to restore alarms after reboot", e);
        }
    }
}
