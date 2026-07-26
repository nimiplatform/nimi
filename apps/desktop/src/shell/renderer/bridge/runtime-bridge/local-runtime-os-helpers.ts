import {
  hasShellHostInvoke,
  hasTauriInvoke,
  openShellFileDialog,
  revealShellFile,
  type ShellFileDialogOpenResult,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';
import { getDesktopStorageDirs } from './desktop-storage';

function parseOptionalPath(value: unknown): string | null {
  const path = typeof value === 'string' ? value.trim() : '';
  return path || null;
}

function firstDialogPath(result: ShellFileDialogOpenResult): string | null {
  if (result.canceled) return null;
  const path = typeof result.paths[0] === 'string' ? result.paths[0].trim() : '';
  return path || null;
}

function isSafeLocalAssetId(localAssetId: string): boolean {
  const trimmed = localAssetId.trim();
  return Boolean(trimmed)
    && trimmed !== '.'
    && trimmed !== '..'
    && /^[A-Za-z0-9_.-]+$/u.test(trimmed);
}

function joinHostPath(root: string, child: string): string {
  const separator = root.includes('\\') ? '\\' : '/';
  const trimmedRoot = root.replace(/[\\/]+$/u, '');
  const trimmedChild = child.replace(/^[\\/]+|[\\/]+$/gu, '');
  return [trimmedRoot, trimmedChild].filter(Boolean).join(separator);
}

function isStandardRevealNotFound(error: unknown): boolean {
  const reasonCode = error && typeof error === 'object'
    ? String((error as { readonly reasonCode?: unknown }).reasonCode || '').trim()
    : '';
  if (reasonCode === 'tauri-standard-file-reveal-target-not-found'
    || reasonCode === 'electron-file-reveal-target-not-found') {
    return true;
  }
  return error instanceof Error
    && /(?:not-found|target-not-found)/iu.test(error.message);
}

async function localRuntimeModelsRoot(): Promise<string> {
  const root = (await getDesktopStorageDirs()).modelsDir.trim();
  if (!root) {
    throw new Error('Local runtime models root is unavailable');
  }
  return root;
}

export async function pickLocalRuntimeAssetManifestPath(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  return invokeChecked('runtime_local_pick_asset_manifest_path', {}, parseOptionalPath);
}

export async function pickLocalRuntimeAssetFile(): Promise<string | null> {
  if (!hasShellHostInvoke()) return null;
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
  if (!hasShellHostInvoke()) return null;
  return firstDialogPath(await openShellFileDialog({
    kind: 'directory',
    title: 'Select asset bundle directory to import',
  }));
}

export async function revealLocalRuntimeAssetInFolder(localAssetId: string): Promise<void> {
  if (!hasShellHostInvoke()) {
    throw new Error('Local runtime asset reveal requires standard shell file reveal');
  }
  const modelsRoot = await localRuntimeModelsRoot();
  const trimmed = localAssetId.trim();
  if (!isSafeLocalAssetId(trimmed)) {
    await revealShellFile(modelsRoot);
    return;
  }
  try {
    await revealShellFile(joinHostPath(modelsRoot, trimmed));
  } catch (error) {
    if (!isStandardRevealNotFound(error)) {
      throw error;
    }
    await revealShellFile(modelsRoot);
  }
}

export async function revealLocalRuntimeAssetsRootFolder(): Promise<void> {
  if (!hasShellHostInvoke()) {
    throw new Error('Local runtime asset root reveal requires standard shell file reveal');
  }
  await revealShellFile(await localRuntimeModelsRoot());
}
