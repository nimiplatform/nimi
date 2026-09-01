import assert from 'node:assert/strict';
import test from 'node:test';

import { runtimeConfigInstallConfirmationMessage } from '../src/shell/renderer/features/runtime-config/runtime-config-panel-controller-install-actions.js';

const translate = (_key: string, defaultValue: string, options?: Record<string, unknown>) => (
  defaultValue
    .replace('{{name}}', String(options?.name ?? ''))
    .replace('{{size}}', String(options?.size ?? ''))
);

test('install confirmation includes every Runtime warning before download starts', () => {
  const message = runtimeConfigInstallConfirmationMessage({
    name: 'Video model',
    size: '24 GB',
    warnings: ['Requires 24 GB VRAM', 'Some download sizes are unknown'],
    repository: 'audio-cpp/MiniMax-Music3-GGUF',
    revision: 'test-revision',
    license: 'MiniMax-Music3 Community License',
    fileCount: 15,
    translate,
  });

  assert.match(message, /Video model/u);
  assert.match(message, /24 GB/u);
  assert.match(message, /Requires 24 GB VRAM/u);
  assert.match(message, /Some download sizes are unknown/u);
  assert.match(message, /audio-cpp\/MiniMax-Music3-GGUF@test-revision/u);
  assert.match(message, /MiniMax-Music3 Community License/u);
  assert.match(message, /Files: 15/u);
});
