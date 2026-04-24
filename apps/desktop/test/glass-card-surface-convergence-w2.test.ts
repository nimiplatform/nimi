import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const sharedSurfaceSource = readWorkspaceFile('src/shell/renderer/components/surface.tsx');
const chatRightColumnSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-shared-right-column-primitives.tsx');
const settingsLayoutSource = readWorkspaceFile('src/shell/renderer/features/settings/settings-layout-components.tsx');
const runtimePrimitivesSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-primitives.tsx');
const runtimeLocalDebugSource = readWorkspaceFile('src/shell/renderer/features/runtime-config/runtime-config-local-debug-section.tsx');

test('W2 glass card convergence: shared desktop card surface freezes promoted and operational kinds', () => {
  assert.match(sharedSurfaceSource, /type DesktopCardSurfaceKind = 'promoted-glass' \| 'operational-solid'/);
  assert.match(sharedSurfaceSource, /material=\{kind === 'promoted-glass' \? 'glass-regular' : 'solid'\}/);
  assert.match(sharedSurfaceSource, /data-desktop-card-surface=\{kind\}/);
});

test('W2 glass card convergence: chat right-column cards consume the shared promoted glass primitive', () => {
  assert.match(chatRightColumnSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(chatRightColumnSource, /<DesktopCardSurface[\s\S]*kind="promoted-glass"/);
  assert.doesNotMatch(chatRightColumnSource, /RIGHT_COLUMN_CARD_BASE_CLASS/u);
});

test('W2 glass card convergence: settings and runtime shared cards consume the shared operational primitive', () => {
  assert.match(settingsLayoutSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(settingsLayoutSource, /<DesktopCardSurface[\s\S]*kind="operational-solid"/);
  assert.match(runtimePrimitivesSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(runtimePrimitivesSource, /<DesktopCardSurface[\s\S]*kind="operational-solid"/);
});

test('W2 glass card convergence: runtime local debug section reuses the shared operational card wrapper', () => {
  assert.match(runtimeLocalDebugSource, /import \{ Button \} from '.\/runtime-config-primitives\.js';/);
  assert.match(runtimeLocalDebugSource, /import \{ ScrollArea, Surface, Tooltip, cn \} from '@nimiplatform\/nimi-kit\/ui';/);
  assert.match(runtimeLocalDebugSource, /<Surface tone="card" className=\{cn\(TOKEN_PANEL_CARD, 'overflow-hidden'\)\}>/);
  assert.doesNotMatch(runtimeLocalDebugSource, /function SurfaceCard/u);
});
