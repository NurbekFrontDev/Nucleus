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
}
