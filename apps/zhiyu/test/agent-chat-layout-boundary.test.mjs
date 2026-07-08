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
  assert.match(
    css,
    /\.zhiyu-home__runtime-action-artifact-summary\s*\{[\s\S]*?display:\s*grid;[\s\S]*?gap:\s*8px;/,
    'Runtime action summaries must be readable compact cards, not unspaced inline text',
  );
  assert.match(
    css,
    /\.zhiyu-home__runtime-action-artifact-head\s*\{[\s\S]*?display:\s*flex;[\s\S]*?gap:\s*8px;/,
    'Runtime action summary headings must separate the label from the status',
  );
  assert.match(
    css,
    /\.zhiyu-home__runtime-action-artifact-grid\s*\{[\s\S]*?display:\s*flex;[\s\S]*?gap:\s*6px;/,
    'Runtime action summary event chips must wrap with visible spacing',
  );
});

test('narrow open Agent Center remains visible as an operable side sheet', () => {
  const css = readSource('src/shell/app/home-surface.css');

  assert.match(
    css,
    /@media \(max-width:\s*640px\)[\s\S]*?\.zhiyu-agent-chat__layout:not\(\.is-side-closed\) \.zhiyu-agent-center\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*8px;[\s\S]*?z-index:\s*30;[\s\S]*?height:\s*calc\(100dvh - 16px\);[\s\S]*?width:\s*calc\(100vw - 16px\);/,
    'open Agent Center must be visible inside the 640px viewport instead of being placed below a non-scrollable conversation row',
  );
  assert.match(
    css,
    /@media \(max-width:\s*640px\)[\s\S]*?\.zhiyu-agent-chat__layout:not\(\.is-side-closed\) \[data-zhiyu-agent-center-kit-surface="true"\]\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?-webkit-overflow-scrolling:\s*touch;/,
    'narrow Agent Center body must own vertical scrolling once the side sheet is fixed',
  );
});

test('unselected-partner transcript empty state guides existing selection and adding more partners', () => {
  const surface = readSource('src/shell/agent-chat/ZhiyuAgentChatSurface.tsx');

  assert.match(surface, /emptyEyebrow="ZHIYU"/);
  assert.match(surface, /const hasLocalPartners = evidence\.inventory\.localAgents\.length > 0;/);
  assert.match(surface, /'选择一位本地伙伴，开始对话'/);
  assert.doesNotMatch(surface, /请先在左侧选择一位已有的本地伙伴开始对话/);
  assert.match(surface, /'如果想添加更多伙伴，请到Nimi桌面端的「探索」中选择角色。'/);
  assert.doesNotMatch(surface, /Desktop Explore/);
  assert.doesNotMatch(surface, /不伪造身份/);
});

test('no-partner transcript empty state keeps the relationship rail empty and shows honest explore guidance', () => {
  const surface = readSource('src/shell/agent-chat/ZhiyuAgentChatSurface.tsx');
  const panel = readSource('src/shell/agent-chat/ZhiyuAgentPanel.tsx');
  const css = readSource('src/shell/app/home-surface.css');

  assert.match(
    panel,
    /data-zhiyu-relationship-rail-empty=\{String\(agents\.length === 0\)\}/,
    'relationship rail must expose that no local partner candidates are rendered',
  );
  assert.doesNotMatch(
    panel,
    /agents\.length\s*===\s*0[\s\S]{0,200}data-zhiyu-local-agent-candidate="true"/,
    'empty relationship rail must not render a synthetic local partner candidate',
  );
  assert.match(
    surface,
    /const emptyTitle = hasCurrentPartner\s*\? '开始一段对话'\s*:\s*hasLocalPartners\s*\? '选择一位本地伙伴，开始对话'\s*:\s*'还没有本地伙伴';/,
    'no-partner state must not keep the select-existing-partner title',
  );
  assert.match(surface, /const noLocalPartnerEmptyState = !hasCurrentPartner && !hasLocalPartners/);
  assert.match(
    surface,
    /const chatRuntimeHint = chatDisabled && \(hasLocalPartners \|\| evidence\.chat\.state === 'streaming'\)/,
    'empty local partner inventory must not render a duplicate composer warning strip',
  );
  assert.match(surface, /data-zhiyu-no-local-partner-empty="true"/);
  assert.match(surface, /data-zhiyu-no-local-partner-action="show-guidance"/);
  assert.match(surface, /去探索伙伴/);
  assert.match(surface, /从世界中选择一位角色加入本地后，就可以和他开始对话。/);
  assert.match(surface, /本地伙伴会保留角色来源与身份设定。/);
  assert.match(css, /\.zhiyu-no-local-partner-empty\s*\{/);
  assert.match(css, /\.zhiyu-no-local-partner-empty__action\s*\{/);
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
