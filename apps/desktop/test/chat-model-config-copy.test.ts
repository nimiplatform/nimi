import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveChatSettingsCapabilityDescription,
  resolveChatSettingsCapabilityLabel,
} from '../src/shell/renderer/features/chat/chat-model-config-copy.js';

const LABELS: Record<string, string> = {
  'runtimeConfig.capabilityLabels.imageGenerate': 'Image generation',
  'runtimeConfig.capabilityLabels.audioTranscribe': 'Audio transcription',
};

// Minimal TFunction double: known keys resolve to the label map, otherwise the
// defaultValue (i18next behavior), otherwise the key itself.
const t = ((key: string, options?: { defaultValue?: string }) => (
  LABELS[key] ?? options?.defaultValue ?? key
)) as never;

test('chat capability rows label each capability by its real contract, not a hardcoded text label', () => {
  assert.equal(resolveChatSettingsCapabilityLabel('text.generate', 'fallback', t), 'Text generation');
  assert.equal(resolveChatSettingsCapabilityLabel('image.generate', 'fallback', t), 'Image generation');
  assert.equal(resolveChatSettingsCapabilityLabel('audio.transcribe', 'fallback', t), 'Audio transcription');
  // An unknown contract falls back to the caller label, then to the contract
  // itself — never to another capability's label.
  assert.equal(resolveChatSettingsCapabilityLabel('future.capability', 'Future capability', t), 'future.capability');
});

test('chat capability descriptions stay text-specific only for text.generate', () => {
  assert.equal(
    resolveChatSettingsCapabilityDescription('text.generate', 'fallback', t),
    'Controls how Nimi Chat resolves text generation.',
  );
  assert.equal(
    resolveChatSettingsCapabilityDescription('image.generate', 'Image description', t),
    'Image description',
  );
  assert.equal(
    resolveChatSettingsCapabilityDescription('image.generate', undefined, t),
    'image.generate',
  );
});
