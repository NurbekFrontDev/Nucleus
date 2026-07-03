package com.nucleus.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Нативный плагин управления энергосбережением (этап А-8).
 *
 * Android (особенно Xiaomi/MIUI, Samsung, Huawei, Oppo, Vivo) агрессивно
 * «усыпляет» приложения ради батареи, из-за чего уведомления могут
 * опаздывать или не приходить. Этот плагин помогает пользователю:
 *  - проверить, исключено ли приложение из оптимизации батареи;
 *  - открыть системный диалог «не оптимизировать»;
 *  - открыть экран «Автозапуск» (фича конкретных прошивок);
 *  - открыть системную карточку приложения (универсальный запасной вариант).
 *
 * На вебе плагина нет — мост (src/lib/battery.ts) превращает всё в no-op.
 */
@CapacitorPlugin(name = "Battery")
public class BatteryPlugin extends Plugin {

    private boolean isIgnoringInternal() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M);
        call.resolve(ret);
    }

    @PluginMethod
    public void isIgnoring(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ignoring", isIgnoringInternal());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnore(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (isIgnoringInternal()) {
                ret.put("ignoring", true);
                call.resolve(ret);
                return;
            }
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception e) {
                // Некоторые прошивки блокируют прямой запрос — открываем общий список.
                try {
                    Intent list = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    list.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(list);
                } catch (Exception ignored) {
                    // экран недоступен — не критично
                }
            }
        }
        ret.put("ignoring", isIgnoringInternal());
        call.resolve(ret);
    }

    @PluginMethod
    public void openAutoStart(PluginCall call) {
        // «Автозапуск» — фича конкретных прошивок (в первую очередь MIUI/Xiaomi).
        // Пробуем известные экраны по очереди; при неудаче — карточка приложения.
        String[][] targets = new String[][] {
            {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
            {"com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity"},
            {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
            {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
            {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
            {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"}
        };
        for (String[] t : targets) {
            try {
                Intent intent = new Intent();
                intent.setComponent(new ComponentName(t[0], t[1]));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
                return;
            } catch (Exception ignored) {
                // пробуем следующий вариант
            }
        }
        openAppDetailsInternal();
        call.resolve();
    }

    @PluginMethod
    public void openAppDetails(PluginCall call) {
        openAppDetailsInternal();
        call.resolve();
    }

    private void openAppDetailsInternal() {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception ignored) {
            // не критично
        }
    }
}
