import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureLive2dCubismCoreLoaded,
  hasLive2dCubismCore,
  loadOfficialCubismRuntimeModules,
  resolveLive2dCubismCoreScriptUrl,
} from '../src/desktop-adapter/chat-agent-avatar-live2d-cubism-runtime-loader.web.js';

test('web Live2D Cubism runtime adapter fails closed without importing desktop core', async () => {
  assert.equal(hasLive2dCubismCore(), false);
  assert.throws(
    () => resolveLive2dCubismCoreScriptUrl(),
    /Live2D Cubism Core script is not available in the web shell/,
  );
  await assert.rejects(
    () => ensureLive2dCubismCoreLoaded(),
    /Live2D Cubism Core is not available in the web shell/,
  );
  await assert.rejects(
    () => loadOfficialCubismRuntimeModules(),
    /Live2D Cubism runtime is not available in the web shell/,
  );
});
