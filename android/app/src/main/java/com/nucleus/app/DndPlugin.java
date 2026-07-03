package com.nucleus.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Нативный плагин «тихого режима» (Do Not Disturb) для Pomodoro-фокуса.
 *
 * Во время фокуса включаем системный режим «только приоритет», в котором
 * разрешены лишь звонки (в т.ч. повторные), а обычные уведомления и звуки
 * не шумят. По окончании фокуса возвращаем обычный режим.
 *
 * Требует разовое разрешение пользователя «Доступ к режиму Не беспокоить»
 * (ACCESS_NOTIFICATION_POLICY). Метод openSettings открывает нужный экран.
 */
@CapacitorPlugin(name = "Dnd")
public class DndPlugin extends Plugin {

    private NotificationManager nm() {
        return (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M);
        call.resolve(ret);
    }

    @PluginMethod
    public void hasPermission(PluginCall call) {
        boolean granted = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            NotificationManager n = nm();
            granted = n != null && n.isNotificationPolicyAccessGranted();
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                Intent intent = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception ignored) {
                // экран настроек недоступен — не критично
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void enable(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            ret.put("granted", false);
            call.resolve(ret);
            return;
        }
        NotificationManager n = nm();
        if (n == null || !n.isNotificationPolicyAccessGranted()) {
            ret.put("granted", false);
            call.resolve(ret);
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                // Разрешаем звонки (в т.ч. повторные) от кого угодно. На Android 9+
                // дополнительно оставляем системные звуки (громкость и сигналы самого
                // телефона), будильники и медиа — их DND не приглушает. Молчат только
                // уведомления и сообщения.
                int categories = NotificationManager.Policy.PRIORITY_CATEGORY_CALLS
                        | NotificationManager.Policy.PRIORITY_CATEGORY_REPEAT_CALLERS;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    categories |= NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS
                            | NotificationManager.Policy.PRIORITY_CATEGORY_MEDIA
                            | NotificationManager.Policy.PRIORITY_CATEGORY_SYSTEM;
                }
                NotificationManager.Policy policy = new NotificationManager.Policy(
                        categories,
                        NotificationManager.Policy.PRIORITY_SENDERS_ANY,
                        0);
                n.setNotificationPolicy(policy);
            }
            n.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
            ret.put("granted", true);
        } catch (Exception e) {
            ret.put("granted", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void disable(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            NotificationManager n = nm();
            if (n != null && n.isNotificationPolicyAccessGranted()) {
                try {
                    n.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
                } catch (Exception ignored) {
                    // не удалось вернуть звук — не критично
                }
            }
        }
        call.resolve();
    }
}
