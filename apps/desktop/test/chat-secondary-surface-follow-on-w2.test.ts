import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const actionSource = readWorkspaceFile('src/shell/renderer/components/action.tsx');
const chatPageSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-page.tsx');
const chatRightPanelSettingsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-right-panel-settings.tsx');
const chatSessionListSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-session-list-panel.tsx');
const chatHistorySource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-history-panel.tsx');
const chatRuntimeInspectSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-runtime-inspect-content.tsx');
const chatDiagnosticsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-diagnostics.tsx');
const chatTargetSelectorSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-target-selector.tsx');
const chatRightRailSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-right-panel-character-rail.tsx');

test('W2 chat surface follow-on: shared Desktop actions freeze compact, toggle, and field-trigger paths', () => {
  assert.match(actionSource, /export function DesktopCompactAction/);
  assert.match(actionSource, /export function DesktopIconToggleAction/);
  assert.match(actionSource, /export function DesktopFieldTrigger/);
});

test('W2 chat surface follow-on: page composition keeps toggle ownership in the sidebar shell while rail controls consume the shared icon toggle action path', () => {
  assert.match(chatPageSource, /import \{ ChatContactsSidebar \} from '\.\/chat-contacts-sidebar';/);
  assert.match(chatPageSource, /<ChatContactsSidebar[\s\S]*onToggleSettings=\{toggleChatSettings\}[\s\S]*onToggleNimiThreadList=\{toggleNimiThreadList\}/);
  assert.doesNotMatch(chatPageSource, /emerald-/u);
  assert.match(chatRightPanelSettingsSource, /import \{ DesktopIconToggleAction \} from '@renderer\/components\/action';/);
  assert.match(chatRightPanelSettingsSource, /<DesktopIconToggleAction[\s\S]*data-chat-settings-toggle="true"/);
  assert.match(chatRightRailSource, /import \{ DesktopIconToggleAction \} from '@renderer\/components\/action';/);
  assert.match(chatRightRailSource, /<DesktopIconToggleAction/);
});

test('W2 chat surface follow-on: session and history cards consume shared Desktop surface and action primitives', () => {
  assert.match(chatSessionListSource, /import \{ DesktopCompactAction \} from '@renderer\/components\/action';/);
  assert.match(chatSessionListSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(chatSessionListSource, /<DesktopCardSurface[\s\S]*kind="operational-solid"/);
  assert.match(chatSessionListSource, /<DesktopCompactAction[\s\S]*tone="primary"[\s\S]*fullWidth/);
  assert.doesNotMatch(chatSessionListSource, /emerald-/u);
  assert.match(chatHistorySource, /import \{ DesktopCompactAction \} from '@renderer\/components\/action';/);
  assert.match(chatHistorySource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(chatHistorySource, /<DesktopCardSurface[\s\S]*kind="operational-solid"/);
  assert.match(chatHistorySource, /<DesktopCompactAction/);
  assert.doesNotMatch(chatHistorySource, /emerald-/u);
});

test('W2 chat surface follow-on: target selector, inspect, and diagnostics panels consume shared operational primitives', () => {
  assert.match(chatTargetSelectorSource, /import \{ DesktopFieldTrigger \} from '@renderer\/components\/action';/);
  assert.match(chatTargetSelectorSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(chatTargetSelectorSource, /<DesktopFieldTrigger/);
  assert.match(chatTargetSelectorSource, /<DesktopCardSurface kind="operational-solid"/);
  assert.doesNotMatch(chatTargetSelectorSource, /emerald-|teal-600/u);
  assert.match(chatRuntimeInspectSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(chatRuntimeInspectSource, /<DesktopCardSurface kind="operational-solid"/);
  assert.match(chatDiagnosticsSource, /import \{ DesktopCompactAction \} from '@renderer\/components\/action';/);
  assert.match(chatDiagnosticsSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(chatDiagnosticsSource, /DIAGNOSTIC_INPUT_CLASS_NAME/);
  assert.match(chatDiagnosticsSource, /<DesktopCompactAction/);
  assert.doesNotMatch(chatDiagnosticsSource, /emerald-/u);
});
