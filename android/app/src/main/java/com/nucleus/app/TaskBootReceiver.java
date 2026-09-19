package com.nucleus.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Восстанавливает активные будильники напоминаний после перезагрузки устройства.
 */
public class TaskBootReceiver extends BroadcastReceiver {
    private static final String TAG = "TaskBootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(action) ||
            "com.htc.intent.action.QUICKBOOT_POWERON".equals(action)) {
            Log.i(TAG, "Device rebooted, restoring task reminders...");
            TaskReminderPlugin.restoreAllReminders(context);
        }
    }
}
