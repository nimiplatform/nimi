import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RuntimeConfigMemoryEmbeddingSection } from '../src/shell/renderer/features/runtime-config/runtime-config-memory-embedding-section';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';

test('runtime config memory embedding section renders Runtime-owned intent availability view', () => {
  const state = createDefaultStateV11();
  const markup = renderToStaticMarkup(
    <RuntimeConfigMemoryEmbeddingSection state={state} />,
  );

  assert.match(markup, /Memory Embedding/);
  assert.match(markup, /Runtime-owned intent/);
  assert.doesNotMatch(markup, /Current selection/);
});
