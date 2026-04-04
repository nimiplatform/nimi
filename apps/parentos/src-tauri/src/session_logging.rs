use std::sync::Once;

static PANIC_HOOK: Once = Once::new();

pub fn install_panic_hook() {
    PANIC_HOOK.call_once(|| {
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            eprintln!("[parentos:panic] {info}");
            default_hook(info);
        }));
    });
}

pub fn log_boot_marker(label: &str) {
    eprintln!("[parentos:boot] {label}");
}

#[tauri::command]
pub fn log_renderer_event(level: String, message: String) {
    eprintln!("[parentos:renderer:{level}] {message}");
}
