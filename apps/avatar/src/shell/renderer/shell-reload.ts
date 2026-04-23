export function reloadAvatarShell(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.location.reload();
}
