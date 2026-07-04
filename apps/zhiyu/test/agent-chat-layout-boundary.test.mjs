import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('settings-open chat layout centers conversation tracks', () => {
  const surface = readSource('src/shell/agent-chat/ZhiyuAgentChatSurface.tsx');
  const panel = readSource('src/shell/agent-chat/ZhiyuAgentPanel.tsx');
  const css = readSource('src/shell/app/home-surface.css');
  const presenceRail = sourceBetween(panel, 'export function DesktopPresenceRail', 'function normalizedDisplayName');

  for (const forbidden of [
    /\bBell\b/,
    /\bPlus\b/,
    /\bMessageSquare\b/,
    /\bDatabase\b/,
    /\bImage\b/,
    /\bPanelRightOpen\b/,
    /data-zhiyu-topbar-chrome/,
    /data-zhiyu-topbar-notifications/,
    /data-zhiyu-topbar-account/,
    /data-zhiyu-notification-state/,
    /data-zhiyu-account-menu/,
    /data-zhiyu-primary-action/,
    /data-zhiyu-diagnostics-toggle/,
    /data-zhiyu-diagnostics-entry/,
    /zhiyu-home__desktop-nav/,
    /zhiyu-home__agent-bubble--add/,
  ]) {
    assert.doesNotMatch(
      presenceRail,
      forbidden,
      `presence relationship rail must not keep migrated global/add chrome: ${forbidden}`,
    );
  }

  assert.match(
    presenceRail,
    /data-zhiyu-settings-entry="presence-rail"/,
    'presence rail must expose the compact settings entry',
  );
  assert.match(
    surface,
    /const openAdvancedSettings = \(\) => \{[\s\S]*?setRightPanelMode\('agent'\);[\s\S]*?setActiveAgentTab\('advanced'\);[\s\S]*?\};/,
    'settings must open the Agent Center advanced/settings tab',
  );
  assert.match(
    surface,
    /onOpenSettings=\{openAdvancedSettings\}/,
    'settings entry must use the merged Agent Center settings route',
  );
  assert.doesNotMatch(surface, /diagnosticsOpen|setDiagnosticsOpen|data-zhiyu-diagnostics-drawer|zhiyu-home__diagnostics-layer|<RelationshipRail/);
  assert.doesNotMatch(css, /zhiyu-home__desktop-nav|zhiyu-home__right-rail|zhiyu-home__agents-rail|is-relationship-empty|diagnostics-drawer/);

  assert.match(
    presenceRail,
    /className="zhiyu-agent-rail"/,
    'presence rail must use the hard-cut agent chat rail shell',
  );
  assert.match(
    presenceRail,
    /zhiyu-agent-rail__agents/,
    'presence rail must keep relationship controls in the left rail',
  );
  assert.match(
    surface,
    /className="zhiyu-agent-chat"/,
    'home surface must expose the single primary agent chat shell',
  );
  assert.match(
    surface,
    /data-zhiyu-agent-chat-shell="primary"/,
    'home surface must declare the primary agent chat boundary',
  );
  assert.match(
    css,
    /\.zhiyu-agent-chat__layout\s*\{[\s\S]*?grid-template-columns:\s*76px minmax\(0,\s*1fr\) 500px;[\s\S]*?gap:\s*0;/,
    'open Agent Center layout must preserve the Desktop rail, transparent chat canvas, and 500px Agent Center rhythm',
  );
  assert.match(
    css,
    /\.zhiyu-agent-chat__layout\.is-side-closed\s*\{[\s\S]*?grid-template-columns:\s*76px minmax\(0,\s*1fr\);/,
    'closed Agent Center layout must reserve only the presence rail and chat canvas',
  );
  assert.match(
    css,
    /\.zhiyu-chat-canvas__transcript\s+\[data-canonical-transcript-width\][\s\S]*?\.zhiyu-chat-canvas__composer\s+\[data-canonical-composer-width\][\s\S]*?\{[\s\S]*?margin-right:\s*auto;[\s\S]*?margin-left:\s*auto;/,
    'chat canvas must center transcript and composer tracks inside the available conversation space',
  );
  assert.match(
    css,
    /\.zhiyu-chat-canvas__composer\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/,
    'composer container must keep the Kit canonical composer responsive inside the chat canvas',
  );
});

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} missing`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${endMarker} missing after ${startMarker}`);
  return source.slice(start, end);
}
