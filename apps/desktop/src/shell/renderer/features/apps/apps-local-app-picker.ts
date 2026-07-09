import {
  hasShellHostInvoke,
  openShellFileDialog,
  type ShellFileDialogOpenResult,
} from '@nimiplatform/kit/shell/renderer/bridge';

function firstDialogPath(result: ShellFileDialogOpenResult): string | null {
  if (result.canceled) return null;
  const path = typeof result.paths[0] === 'string' ? result.paths[0].trim() : '';
  return path || null;
}

export async function pickLocalAppRootDirectory(): Promise<string | null> {
  if (!hasShellHostInvoke()) return null;
  return firstDialogPath(await openShellFileDialog({
    kind: 'directory',
    title: 'Select local app root directory',
  }));
}
