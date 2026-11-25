import type { NimiElectronFileDialogOpenPayload, NimiElectronFileDialogOpenResult } from '@nimiplatform/kit/shell/electron/main';

// @nimi-authority: rule.nimi.runtime.local-compute.desktop-selected-file-import
export async function importPickedModelFile(
  choose: (options: NimiElectronFileDialogOpenPayload) => Promise<NimiElectronFileDialogOpenResult>,
  importFile: (path: string) => Promise<void>,
): Promise<boolean> {
  const selection = await choose({
    kind: 'file',
    title: 'Select asset file to import',
    filters: [
      { name: 'Asset Files', extensions: ['gguf', 'gguf_file', 'safetensors', 'bin', 'pt', 'onnx', 'pth'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (selection.canceled) return false;
  if (selection.paths.length !== 1 || !selection.paths[0]) throw new Error('desktop-model-file-picker-required');
  await importFile(selection.paths[0]);
  return true;
}
