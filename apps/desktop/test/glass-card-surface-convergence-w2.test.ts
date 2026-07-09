import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const settingsLayoutSource = readWorkspaceFile('src/shell/renderer/features/settings/settings-layout-components.tsx');
const runtimePrimitivesSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-primitives.tsx');
const runtimeLocalDebugSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-local-debug-section.tsx');

test('W2 glass card convergence: retired chat right-column primitive is hard-cut', () => {
  assert.equal(
    fs.existsSync(path.join(import.meta.dirname, '..', 'src/shell/renderer/features/chat/chat-shared-right-column-primitives.tsx')),
    false,
  );
});

test('W2 glass card convergence: settings and runtime shared cards consume the kit operational primitive', () => {
  assert.match(settingsLayoutSource, /AppCardSurface/);
  assert.match(settingsLayoutSource, /<AppCardSurface[\s\S]*kind="operational-solid"/);
  assert.match(runtimePrimitivesSource, /AppCardSurface/);
  assert.match(runtimePrimitivesSource, /<AppCardSurface[\s\S]*kind="operational-solid"/);
});

test('W2 glass card convergence: runtime local debug section reuses the shared operational card wrapper', () => {
  assert.match(runtimeLocalDebugSource, /import \{ Button \} from '.\/runtime-config-primitives\.js';/);
  assert.match(runtimeLocalDebugSource, /import \{ ScrollArea, Surface, Tooltip, cn \} from '@nimiplatform\/kit\/ui';/);
  assert.match(runtimeLocalDebugSource, /<Surface tone="card" className=\{cn\(TOKEN_PANEL_CARD, 'overflow-hidden'\)\}>/);
  assert.doesNotMatch(runtimeLocalDebugSource, /function SurfaceCard/u);
});
