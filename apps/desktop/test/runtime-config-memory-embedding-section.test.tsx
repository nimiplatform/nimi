import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RuntimeConfigMemoryEmbeddingSection } from '../src/shell/renderer/features/runtime-config/runtime-config-memory-embedding-section';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';

const memoryEmbeddingSectionSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-memory-embedding-section.tsx'),
  'utf8',
);

test('runtime config memory embedding section renders Runtime-owned intent availability view', () => {
  const state = createDefaultStateV11();
  const markup = renderToStaticMarkup(
    <RuntimeConfigMemoryEmbeddingSection state={state} />,
  );

  assert.match(markup, /Memory Embedding/);
  assert.match(markup, /Runtime-owned intent/);
  assert.doesNotMatch(markup, /Current selection/);
});

test('runtime config memory embedding availability consumes the SDK route projection', () => {
  assert.match(memoryEmbeddingSectionSource, /projectMemoryEmbeddingRouteAvailability/);
  assert.match(memoryEmbeddingSectionSource, /from '@nimiplatform\/sdk\/runtime'/);
  assert.doesNotMatch(memoryEmbeddingSectionSource, /getDesktopMemoryEmbeddingConfigService/);
  assert.doesNotMatch(memoryEmbeddingSectionSource, /memoryEmbeddingConfig\.update/);
  assert.doesNotMatch(memoryEmbeddingSectionSource, /memoryEmbeddingConfig\.get/);
  assert.doesNotMatch(memoryEmbeddingSectionSource, /connector\?\.available/);
  assert.doesNotMatch(memoryEmbeddingSectionSource, /String\(model\.status \|\| ''\)\.toLowerCase\(\) === 'active'/);
});
