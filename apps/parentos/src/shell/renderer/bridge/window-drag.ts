import { hasTauriInvoke, invoke } from './index.js';

export async function startParentosWindowDrag(): Promise<void> {
  if (!hasTauriInvoke()) {
    return;
  }

  try {
    await invoke('parentos_start_window_drag', {});
  } catch {
    // Dragging is best-effort and should not break interaction.
  }
}
