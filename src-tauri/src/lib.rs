// Точка входа Tauri: окно с нашим фронтендом (dist), плагин уведомлений,
// системный трей и сворачивание в трей вместо выхода.
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

// Показать и сфокусировать главное окно (из трея).
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// Windows: включить/выключить всплывающие уведомления (тосты) Windows — используется
// как «Не беспокоить» во время фокуса. Гасит только тосты и их звуки, не трогая
// медиа/громкость системы. enabled=true → тихо (ToastEnabled=0), false → вернуть (1).
#[tauri::command]
fn set_dnd(enabled: bool) {
    #[cfg(target_os = "windows")]
    {
        use std::io::Write;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        // Встраиваем наш C# helper прямо в бинарник
        let helper_exe = include_bytes!("../bin/win_helper.exe");
        let temp_dir = std::env::temp_dir();
        let exe_path = temp_dir.join("nucleus_win_helper.exe");

        // Записываем во временную папку (если его там нет или он старый)
        let _ = std::fs::write(&exe_path, helper_exe);

        // Глушим звуки у мессенджеров (или возвращаем звук)
        let action = if enabled { "mute" } else { "unmute" };
        let _ = std::process::Command::new(&exe_path)
            .args([action, "AyuGram,Discord"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // При попытке запуска второго окна, передаем аргументы первому и фокусим его
            let _ = app.get_webview_window("main").map(|w| {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            });
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![set_dnd])
        .setup(|app| {
            // Меню трея: открыть окно и выйти.
            let show = MenuItem::with_id(app, "show", "Открыть Nucleus", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("no default icon").clone())
                .tooltip("Nucleus")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Левый клик по иконке трея — показать окно.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Закрытие окна не выходит из приложения, а прячет его в трей.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
