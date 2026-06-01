// Scaffold-managed standalone shell entry. Storybook keeps Tauri responsible only
// for window lifecycle and the Kit-owned runtime-transport bridge. Storybook
// narrative authority, truth packages, runs, transcripts, assets, and app-internal
// memory are owned by the renderer/app domain, not by Tauri. No app-specific Tauri
// commands are registered in v1: app-internal project data persists through the
// renderer (localStorage / SDK app-storage roots), so there is no Tauri-owned
// canonical store to expose.

fn main() {
    tauri::Builder::default()
        .invoke_handler(nimi_shell_tauri::nimi_shell_tauri_runtime_bridge_handler![])
        .run(tauri::generate_context!())
        .expect("failed to run Storybook shell");
}
