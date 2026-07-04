package com.nucleus.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.core.app.NotificationCompat;

/**
 * Foreground-сервис таймера Помодоро.
 *
 * Пока таймер идёт — показывает постоянное уведомление с названием фазы
 * (Фокус / Перерыв) и живым отсчётом. Когда отсчёт доходит до 0 — выключает
 * «Не беспокоить», вибрирует и показывает громкое уведомление с нашим звуком;
 * по тапу открывает вкладку Помодоро (deep link com.nucleus.app://focus).
 */
public class FocusTimerService extends Service {
    public static final String CHANNEL_ID = "focus_timer";
    public static final String CHANNEL_DONE_ID = "focus_done";
    public static final int NOTIF_ID = 4711;
    public static final int NOTIF_DONE_ID = 4712;

    public static final String ACTION_SHOW = "com.nucleus.app.FOCUS_SHOW";
    public static final String ACTION_STOP = "com.nucleus.app.FOCUS_STOP";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable ticker;

    private String curTitle = "Nucleus";
    private String curBody = "";
    private String curDoneTitle = "";
    private String curDoneBody = "";
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

        // В ЛЮБОЙ ветке нужен startForeground(), иначе система убивает приложение.
        if (intent == null || ACTION_STOP.equals(action)) {
            startForegroundCompat(buildNotification("Nucleus", "", 0L, false));
            stopTicking();
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }

        curTitle = intent.getStringExtra("title");
        curBody = intent.getStringExtra("body");
        curDoneTitle = intent.getStringExtra("doneTitle");
        curDoneBody = intent.getStringExtra("doneBody");
        curEndTime = intent.getLongExtra("endTime", 0L);
        curRunning = intent.getBooleanExtra("running", false);
        if (curTitle == null) curTitle = "Nucleus";
        if (curBody == null) curBody = "";
        if (curDoneTitle == null) curDoneTitle = "";
        if (curDoneBody == null) curDoneBody = "";

        startForegroundCompat(buildNotification(curTitle, curBody, curEndTime, curRunning));

        if (curRunning && curEndTime > 0) {
            startTicking();
        } else {
            stopTicking();
        }
        return START_NOT_STICKY;
    }

    // Каждую секунду перерисовываем уведомление; когда время вышло — fireDone().
    private void startTicking() {
        stopTicking();
        ticker = new Runnable() {
            @Override
            public void run() {
                long remainingMs = curEndTime - System.currentTimeMillis();
                if (curRunning && remainingMs <= 0) {
                    fireDone();
                    return;
                }
                NotificationManager nm =
                        (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.notify(NOTIF_ID, buildNotification(curTitle, curBody, curEndTime, curRunning));
                }
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

    // Сигнал окончания фазы: выключаем «Не беспокоить», вибрируем и
    // показываем громкое уведомление с нашим звуком; по тапу — вкладка Помодоро.
    private void fireDone() {
        curRunning = false;
        stopTicking();

        NotificationManager nm =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        // 1) Возвращаем звук (выключаем режим «Не беспокоить»), чтобы сигнал был слышен.
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    && nm != null && nm.isNotificationPolicyAccessGranted()) {
                nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
            }
        } catch (Exception ignored) {
        }

        // 2) Вибрация.
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            long[] pattern = new long[]{0, 400, 200, 400};
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(pattern, -1));
                } else {
                    v.vibrate(pattern, -1);
                }
            }
        } catch (Exception ignored) {
        }

        // 3) Громкое уведомление о завершении (наш звук из канала focus_done).
        try {
            ensureDoneChannel(this);
            if (nm != null) {
                nm.notify(NOTIF_DONE_ID, buildDoneNotif(this, curDoneTitle, curDoneBody));
            }
        } catch (Exception ignored) {
        }

        // 4) Убираем постоянное уведомление таймера и останавливаем сервис.
        try {
            if (nm != null) nm.cancel(NOTIF_ID);
        } catch (Exception ignored) {
        }
        stopForegroundCompat();
        stopSelf();
    }

    private Notification buildNotification(String title, String body, long endTime, boolean running) {
        return buildNotif(this, title, body, endTime, running);
    }

    // Статическая сборка постоянного уведомления — используется и сервисом, и плагином.
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
                .setContentText(body)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setContentIntent(contentPi)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_STATUS);

        if (live) {
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

    // Громкое уведомление окончания фазы (по тапу — deep link на вкладку Фокус).
    static Notification buildDoneNotif(Context ctx, String title, String body) {
        if (title == null || title.isEmpty()) title = "Nucleus";
        if (body == null) body = "";
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("com.nucleus.app://focus"));
        open.setPackage(ctx.getPackageName());
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_NEW_TASK);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(ctx, 1, open, piFlags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_DONE_ID)
                .setSmallIcon(R.drawable.ic_stat_focus)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM);
        // До Android 8 звук задаётся на самом уведомлении (каналов ещё нет).
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            b.setSound(soundUri(ctx));
        }
        return b.build();
    }

    // URI нашего звука из res/raw/notify_sound.wav; если файла нет — системный по умолчанию.
    static Uri soundUri(Context ctx) {
        try {
            int id = ctx.getResources().getIdentifier("notify_sound", "raw", ctx.getPackageName());
            if (id != 0) {
                return Uri.parse("android.resource://" + ctx.getPackageName() + "/" + id);
            }
        } catch (Exception ignored) {
        }
        return android.provider.Settings.System.DEFAULT_NOTIFICATION_URI;
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

    // Канал постоянного уведомления — низкая важность, без звука.
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

    // Канал сигнала окончания фазы: высокая важность, наш звук. Вибрация канала
    // выключена — вибрируем отдельно в fireDone(), чтобы не было двойной вибрации.
    static void ensureDoneChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (nm.getNotificationChannel(CHANNEL_DONE_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_DONE_ID, "Помодоро — сигнал окончания", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Звук и вибрация при завершении фокуса или перерыва");
                ch.enableVibration(false);
                ch.setShowBadge(false);
                AudioAttributes aa = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                ch.setSound(soundUri(ctx), aa);
                nm.createNotificationChannel(ch);
            }
        }
    }
}
