package com.nucleus.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Регистрируем наши нативные плагины (тихий режим DND и уведомление таймера)
        // до инициализации моста Capacitor.
        registerPlugin(DndPlugin.class);
        registerPlugin(FocusNotifyPlugin.class);
        registerPlugin(BatteryPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onPause() {
        super.onPause();
        // ВАЖНО: Предотвращаем заморозку WebView (и WebSocket'ов) в фоне.
        // Так как у нас работает Foreground Service (FocusNotifyPlugin), Android не убьет процесс.
        // Но Capacitor по умолчанию ставит WebView на паузу. Мы отменяем это, чтобы 
        // синхронизация с ПК продолжала работать, даже если приложение свернуто.
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().resumeTimers();
            bridge.getWebView().onResume();
        }
    }
}
