import {
  hasElectronInvoke,
  openShellFileDialog,
  revealShellFile,
  type ShellFileDialogOpenResult,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { getDesktopStorageDirs } from './desktop-storage';

function firstDialogPath(result: ShellFileDialogOpenResult): string | null {
  if (result.canceled) return null;
  const path = typeof result.paths[0] === 'string' ? result.paths[0].trim() : '';
  return path || null;
}

async function localRuntimeModelsRoot(): Promise<string> {
  const root = (await getDesktopStorageDirs()).modelsDir.trim();
  if (!root) {
    throw new Error('Local runtime models root is unavailable');
  }
  return root;
}

export async function pickLocalRuntimeAssetFile(): Promise<string | null> {
  if (!hasElectronInvoke()) return null;
  return firstDialogPath(await openShellFileDialog({
    kind: 'file',
    title: 'Select asset file to import',
    filters: [
      { name: 'Asset Files', extensions: ['gguf', 'safetensors', 'bin', 'pt', 'onnx', 'pth'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  }));
}

export async function pickLocalRuntimeAssetDirectory(): Promise<string | null> {
  if (!hasElectronInvoke()) return null;
  return firstDialogPath(await openShellFileDialog({
    kind: 'directory',
    title: 'Select asset bundle directory to import',
  }));
}

export async function revealLocalRuntimeAssetsRootFolder(): Promise<void> {
  if (!hasElectronInvoke()) {
    throw new Error('Local runtime asset root reveal requires standard shell file reveal');
  }
  await revealShellFile(await localRuntimeModelsRoot());
}
