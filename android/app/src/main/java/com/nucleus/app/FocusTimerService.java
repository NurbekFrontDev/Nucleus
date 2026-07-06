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
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;

/**
 * Foreground-сервис таймера Помодоро.
 *
 * Пока таймер идёт — показывает постоянное уведомление с названием фазы
 * (Фокус / Перерыв) и живым отсчётом. Когда отсчёт доходит до 0 — выключает
 * «Не беспокоить», вибрирует и несколько раз быстро проигрывает системный звук
 * уведомления; показывает уведомление «завершено»; по тапу открывает
 * вкладку Помодоро (deep link com.nucleus.app://focus).
 */
public class FocusTimerService extends Service {
    public static final String CHANNEL_ID = "focus_timer";
    // Новый id канала: старый focus_done уже создан с нашим WAV, а Android
    // не даёт менять звук уже созданного канала. Здесь канал тихий — звук
    // проигрываем сами (системный, несколько раз).
    public static final String CHANNEL_DONE_ID = "focus_done_v2";
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

    // Сигнал окончания фазы: выключаем «Не беспокоить», вибрируем,
    // несколько раз быстро проигрываем системный звук и показываем уведомление.
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

        // 2) Вибрация (через VibratorManager на Android 12+, иначе старым API).
        vibrateDone();

        // 3) Системный звук уведомления по умолчанию, несколько раз подряд.
        playSystemSoundTimes(1);

        // 4) Уведомление о завершении (тихий канал — звук даём сами выше).
        try {
            ensureDoneChannel(this);
            if (nm != null) {
                nm.notify(NOTIF_DONE_ID, buildDoneNotif(this, curDoneTitle, curDoneBody));
            }
        } catch (Exception ignored) {
        }

        // 5) Убираем постоянное уведомление таймера.
        try {
            if (nm != null) nm.cancel(NOTIF_ID);
        } catch (Exception ignored) {
        }
        stopForegroundCompat();

        // Останавливаем сервис с задержкой, чтобы успели проиграться звуки/вибрация.
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                stopSelf();
            }
        }, 3000L);
    }

    // Несколько коротких вибро-импульсов подряд. USAGE_ALARM важен: без него
    // на MIUI/новых Android вибрация часто подавляется (тихий режим/DND).
    private void vibrateDone() {
        Vibrator v = getVibrator();
        if (v == null) return;
        long[] pattern = new long[]{0, 500, 300, 500};
        AudioAttributes aa = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(pattern, -1), aa);
            } else {
                v.vibrate(pattern, -1, aa);
            }
        } catch (Exception e) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(700, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(700);
                }
            } catch (Exception ignored) {
            }
        }
    }

    private Vibrator getVibrator() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm =
                        (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                return vm == null ? null : vm.getDefaultVibrator();
            }
            return (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        } catch (Exception e) {
            return null;
        }
    }

    private Ringtone doneRingtone;

    // Проигрывает системный звук уведомления несколько раз подряд с небольшими
    // паузами, чтобы каждый сигнал был слышен отдельно (не сливались).
    private void playSystemSoundTimes(final int times) {
        Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        if (uri == null) uri = Settings.System.DEFAULT_NOTIFICATION_URI;
        final Uri soundUri = uri;
        for (int i = 0; i < times; i++) {
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (doneRingtone == null) {
                            doneRingtone = RingtoneManager.getRingtone(getApplicationContext(), soundUri);
                            if (doneRingtone != null
                                    && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                                doneRingtone.setAudioAttributes(new AudioAttributes.Builder()
                                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                        .build());
                            }
                        }
                        if (doneRingtone != null) {
                            try {
                                doneRingtone.stop();
                            } catch (Exception ignored) {
                            }
                            doneRingtone.play();
                        }
                    } catch (Exception ignored) {
                    }
                }
            }, i * 600L);
        }
    }

    private Notification buildNotification(String title, String body, long endTime, boolean running) {
        return buildNotif(this, title, body, endTime, running);
    }

    // Статическая сборка постоянного уведомления — используется и сервисом, и плагином.
    static Notification buildNotif(Context ctx, String title, String body, long endTime, boolean running) {
        // Тап по постоянному уведомлению — открываем вкладку Фокус (deep link), откуда бы ни нажали.
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("com.nucleus.app://focus"));
        open.setPackage(ctx.getPackageName());
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_NEW_TASK);
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
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

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

    // Уведомление окончания фазы (по тапу — deep link на вкладку Фокус). Звук
    // проигрывается отдельно (несколько раз), поэтому само уведомление тихое.
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

        return new NotificationCompat.Builder(ctx, CHANNEL_DONE_ID)
                .setSmallIcon(R.drawable.ic_stat_focus)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .build();
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
                // Показывать на экране блокировки полностью (таймер виден).
                ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                ch.setShowBadge(false);
                ch.setSound(null, null);
                nm.createNotificationChannel(ch);
            }
        }
    }

    // Канал сигнала окончания фазы: высокая важность, без собственного звука и
    // вибрации канала — звук и вибрацию даём сами в fireDone(). Старый канал удаляем.
    static void ensureDoneChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            try {
                nm.deleteNotificationChannel("focus_done");
            } catch (Exception ignored) {
            }
            if (nm.getNotificationChannel(CHANNEL_DONE_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_DONE_ID, "Помодоро — сигнал окончания", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Сигнал при завершении фокуса или перерыва");
                ch.enableVibration(false);
                ch.setSound(null, null);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }
}
