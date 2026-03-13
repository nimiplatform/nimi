export function hasTauriInvoke() {
  return typeof window.__TAURI__?.core?.invoke === 'function';
}
