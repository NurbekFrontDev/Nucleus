package com.nucleus.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

import java.util.Locale;

/**
 * Foreground-сервис таймера Помодоро.
 *
 * Показывает постоянное (несмахиваемое) уведомление с названием фазы
 * (Фокус / Перерыв / Длинный перерыв) и живым обратным отсчётом mm:ss.
 *
 * Сервис сам перерисовывает уведомление раз в секунду, поэтому отсчёт виден
 * на любой прошивке (в т.ч. MIUI/HyperOS, где системный хронометр в шторке
 * может не отображаться). Работает в фоне благодаря foreground-сервису.
 */
public class FocusTimerService extends Service {
    public static final String CHANNEL_ID = "focus_timer";
    public static final int NOTIF_ID = 4711;

    public static final String ACTION_SHOW = "com.nucleus.app.FOCUS_SHOW";
    public static final String ACTION_STOP = "com.nucleus.app.FOCUS_STOP";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable ticker;

    private String curTitle = "Nucleus";
    private String curBody = "";
    private long curEndTime = 0L;
    private boolean curRunning = false;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel();
        String action = intent == null ? null : intent.getAction();

        // ВАЖНО: сервис стартует через startForegroundService(), поэтому в ЛЮБОЙ
        // ветке нужно хотя бы один раз вызвать startForeground(), иначе система
        // убивает приложение (ForegroundServiceDidNotStartInTimeException).
        if (intent == null || ACTION_STOP.equals(action)) {
            startForegroundCompat(buildNotification("Nucleus", "", 0L, false));
            stopTicking();
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }

        curTitle = intent.getStringExtra("title");
        curBody = intent.getStringExtra("body");
        curEndTime = intent.getLongExtra("endTime", 0L);
        curRunning = intent.getBooleanExtra("running", false);
        if (curTitle == null) curTitle = "Nucleus";
        if (curBody == null) curBody = "";

        startForegroundCompat(buildNotification(curTitle, curBody, curEndTime, curRunning));

        if (curRunning && curEndTime > 0) {
            startTicking();
        } else {
            stopTicking();
        }
        return START_NOT_STICKY;
    }

    // Каждую секунду перерисовываем уведомление, чтобы отсчёт mm:ss обновлялся
    // вручную (надёжно на любых прошивках).
    private void startTicking() {
        stopTicking();
        ticker = new Runnable() {
            @Override
            public void run() {
                NotificationManager nm =
                        (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.notify(NOTIF_ID, buildNotification(curTitle, curBody, curEndTime, curRunning));
                }
                long remainingMs = curEndTime - System.currentTimeMillis();
                if (curRunning && remainingMs > 0) {
                    handler.postDelayed(this, 1000L);
                }
            }
        };
        handler.post(ticker);
    }

    private void stopTicking() {
        if (ticker != null) {
            handler.removeCallbacks(ticker);
            ticker = null;
        }
    }

    // Оставшееся время в формате mm:ss (не меньше 00:00).
    private String remainingText(long endTime) {
        long ms = endTime - System.currentTimeMillis();
        if (ms < 0) ms = 0;
        long totalSec = ms / 1000L;
        long m = totalSec / 60L;
        long s = totalSec % 60L;
        return String.format(Locale.US, "%02d:%02d", m, s);
    }

    private Notification buildNotification(String title, String body, long endTime, boolean running) {
        return buildNotif(this, title, body, endTime, running);
    }

    // Статическая сборка уведомления — используется и сервисом, и плагином
    // (мгновенный показ по нажатию «старт», до холодного старта foreground-сервиса).
    static Notification buildNotif(Context ctx, String title, String body, long endTime, boolean running) {
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentPi = PendingIntent.getActivity(ctx, 0, open, piFlags);

        boolean live = running && endTime > 0;

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_focus)
                .setContentTitle(title)
                // Отсчёт показываем только справа в шапке (хронометр на одной
                // строке с названием, как в GoodTime). В теле — только подпись
                // (без времени), чтобы отсчёт не дублировался.
                .setContentText(body)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setContentIntent(contentPi)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_STATUS);

        if (live) {
            // Отсчёт справа в шапке на одной строке с названием (как GoodTime):
            // время окончания в setWhen + режим обратного отсчёта.
            b.setWhen(endTime);
            b.setShowWhen(true);
            b.setUsesChronometer(true);
            b.setChronometerCountDown(true);
        } else {
            b.setShowWhen(false);
            b.setUsesChronometer(false);
        }

        return b.build();
    }

    private void startForegroundCompat(Notification notif) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIF_ID, notif);
            }
        } catch (Exception e) {
            try {
                startForeground(NOTIF_ID, notif);
            } catch (Exception ignored) {
                // не критично
            }
        }
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(Service.STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {
            // не критично
        }
    }

    @Override
    public void onDestroy() {
        stopTicking();
        super.onDestroy();
    }

    private void createChannel() {
        ensureChannel(this);
    }

    // Статический вариант — чтобы канал можно было создать из плагина ДО старта
    // сервиса (нужно для мгновенного показа уведомления по нажатию «старт»).
    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "Помодоро / Focus", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Текущее состояние таймера Помодоро");
                ch.setShowBadge(false);
                ch.setSound(null, null);
                nm.createNotificationChannel(ch);
            }
        }
    }
}
