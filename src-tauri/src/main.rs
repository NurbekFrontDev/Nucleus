// На Windows в релизе не открываем лишнее окно консоли. НЕ УДАЛЯТЬ!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nucleus_lib::run()
}
