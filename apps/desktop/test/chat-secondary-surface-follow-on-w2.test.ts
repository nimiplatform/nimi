import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const chatPageSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-page.tsx');
const chatRightPanelSettingsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-right-panel-settings.tsx');
const chatSessionListSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-nimi-session-list-panel.tsx');
const chatCognitionSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-cognition-panel.tsx');
const chatRuntimeInspectSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-runtime-inspect-content.tsx');
const chatDiagnosticsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-diagnostics.tsx');
const chatDiagnosticsControlsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-diagnostics-controls.tsx');

test('W2 chat surface follow-on: page composition keeps toggle ownership in the sidebar shell while rail controls consume the shared icon toggle action path', () => {
  assert.match(chatPageSource, /import \{ ChatRelationshipRail \} from '\.\/chat-relationship-rail';/);
  assert.match(chatPageSource, /<ChatRelationshipRail[\s\S]*onToggleSettings=\{toggleChatSettings\}[\s\S]*onToggleNimiThreadList=\{toggleNimiThreadList\}/);
  assert.doesNotMatch(chatPageSource, /emerald-/u);
  assert.match(chatRightPanelSettingsSource, /import \{ IconToggleAction, ScrollArea, Tooltip \} from '@nimiplatform\/kit\/ui';/);
  assert.match(chatRightPanelSettingsSource, /<IconToggleAction[\s\S]*data-chat-settings-toggle="true"/);
});

test('W2 chat surface follow-on: session and cognition cards consume kit surface and action primitives', () => {
  assert.match(chatSessionListSource, /import \{ AppCardSurface, cn, CompactAction \} from '@nimiplatform\/kit\/ui';/);
  assert.match(chatSessionListSource, /<AppCardSurface[\s\S]*kind="operational-solid"/);
  assert.match(chatSessionListSource, /<CompactAction[\s\S]*tone="primary"[\s\S]*fullWidth/);
  assert.doesNotMatch(chatSessionListSource, /emerald-/u);
  assert.match(chatCognitionSource, /import \{ AppCardSurface, cn, CompactAction \} from '@nimiplatform\/kit\/ui';/);
  assert.match(chatCognitionSource, /<AppCardSurface[\s\S]*kind="operational-solid"/);
  assert.match(chatCognitionSource, /<CompactAction/);
  assert.doesNotMatch(chatCognitionSource, /emerald-/u);
});

test('W2 chat surface follow-on: inspect and diagnostics panels consume shared operational primitives', () => {
  assert.match(chatRuntimeInspectSource, /import \{ AppCardSurface \} from '@nimiplatform\/kit\/ui';/);
  assert.match(chatRuntimeInspectSource, /<AppCardSurface kind="operational-solid"/);
  assert.match(chatDiagnosticsSource, /import \{ CompactAction \} from '@nimiplatform\/kit\/ui';/);
  assert.match(chatDiagnosticsSource, /DIAGNOSTIC_INPUT_CLASS_NAME/);
  assert.match(chatDiagnosticsControlsSource, /import \{ AppCardSurface, CompactAction \} from '@nimiplatform\/kit\/ui';/);
  assert.match(chatDiagnosticsControlsSource, /export const DIAGNOSTIC_INPUT_CLASS_NAME/);
  assert.match(chatDiagnosticsSource, /<CompactAction/);
  assert.doesNotMatch(chatDiagnosticsSource, /emerald-/u);
  assert.doesNotMatch(chatDiagnosticsControlsSource, /emerald-/u);
});
