import assert from 'node:assert/strict';
import test from 'node:test';

import { toAssetImportUserMessage } from '../src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-import-actions';

test('toAssetImportUserMessage strips reason code prefix and keeps symlink target guidance', () => {
  const message = toAssetImportUserMessage(new Error(
    'LOCAL_AI_FILE_IMPORT_SYMLINK_FORBIDDEN: Symbolic links are not supported for import. Import the real file path instead. Link source: /var/tmp/.nimi/data/models/Qwen3-4B-Q4_K_M.gguf. Link target: /var/tmp/ComfyUI/models/clip/Qwen3-4B-Q4_K_M.gguf',
  ));
  assert.equal(
    message,
    'Symbolic links are not supported for import. Import the real file path instead. Link source: /var/tmp/.nimi/data/models/Qwen3-4B-Q4_K_M.gguf. Link target: /var/tmp/ComfyUI/models/clip/Qwen3-4B-Q4_K_M.gguf',
  );
});

test('toAssetImportUserMessage keeps generic user messages unchanged', () => {
  assert.equal(toAssetImportUserMessage('Import failed'), 'Import failed');
});
