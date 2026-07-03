package com.nucleus.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Нативный мост к foreground-сервису таймера Помодоро (FocusTimerService).
 * update — показать/обновить уведомление; stop — убрать его.
 */
@CapacitorPlugin(name = "FocusNotify")
public class FocusNotifyPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "Nucleus");
        String body = call.getString("body", "");
        Boolean runningB = call.getBoolean("running", false);
        boolean running = Boolean.TRUE.equals(runningB);
        // Оставшиеся секунды — маленькое целое, надёжно проходит через мост
        // (в отличие от больших миллисекундных меток). Время окончания для
        // обратного отсчёта вычисляем здесь, на нативной стороне.
        Integer remainingSecI = call.getInt("remainingSec", 0);
        int remainingSec = remainingSecI == null ? 0 : remainingSecI;
        long endTime = (running && remainingSec > 0)
                ? System.currentTimeMillis() + remainingSec * 1000L
                : 0L;

        // Мгновенный показ: постим уведомление напрямую ДО старта foreground-
        // сервиса, чтобы плашка появлялась сразу по нажатию (как в GoodTime), не
        // дожидаясь холодного старта сервиса. Сервис затем «усыновит» это же
        // уведомление (тот же NOTIF_ID) через startForeground — без разрыва.
        try {
            FocusTimerService.ensureChannel(getContext());
            NotificationManager nm = (NotificationManager)
                    getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(FocusTimerService.NOTIF_ID,
                        FocusTimerService.buildNotif(getContext(), title, body, endTime, running));
            }
        } catch (Exception ignored) {
            // не критично — сервис всё равно покажет уведомление
        }

        Intent i = new Intent(getContext(), FocusTimerService.class);
        i.setAction(FocusTimerService.ACTION_SHOW);
        i.putExtra("title", title);
        i.putExtra("body", body);
        i.putExtra("endTime", endTime);
        i.putExtra("running", running);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(i);
            } else {
                getContext().startService(i);
            }
        } catch (Exception e) {
            call.reject("Failed to start focus service: " + e.getMessage());
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent i = new Intent(getContext(), FocusTimerService.class);
        i.setAction(FocusTimerService.ACTION_STOP);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(i);
            } else {
                getContext().startService(i);
            }
        } catch (Exception e) {
            try {
                getContext().stopService(new Intent(getContext(), FocusTimerService.class));
            } catch (Exception ignored) {
                // не критично
            }
        }
        call.resolve();
    }
}
