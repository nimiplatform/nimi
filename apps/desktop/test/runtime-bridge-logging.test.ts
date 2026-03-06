import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldForwardRendererLogLevel } from '../src/shell/renderer/bridge/runtime-bridge/env.js';

test('renderer log forwarding keeps warn/error by default', () => {
  assert.equal(shouldForwardRendererLogLevel('warn'), true);
  assert.equal(shouldForwardRendererLogLevel('error'), true);
});

test('renderer log forwarding drops info/debug by default', () => {
  assert.equal(shouldForwardRendererLogLevel('info'), false);
  assert.equal(shouldForwardRendererLogLevel('debug'), false);
});
