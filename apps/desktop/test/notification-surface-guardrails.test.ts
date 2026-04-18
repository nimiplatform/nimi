import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import test from 'node:test';

function read(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname, `../src/${relativePath}`), 'utf8');
}

function collectSourceFiles(root: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(root)) {
    const absolute = resolve(root, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      output.push(...collectSourceFiles(absolute));
      continue;
    }
    if (absolute.endsWith('.ts') || absolute.endsWith('.tsx')) {
      output.push(absolute);
    }
  }
  return output;
}

test('bootstrap and mod startup noise no longer writes global status banners', () => {
  assert.doesNotMatch(
    read('shell/renderer/infra/bootstrap/runtime-bootstrap-runtime-mods.ts'),
    /setStatusBanner\(/,
  );
  const bootstrapSource = read('shell/renderer/infra/bootstrap/runtime-bootstrap.ts');
  assert.doesNotMatch(bootstrapSource, /message:\s*daemonStatus\.lastError \|\| 'Runtime unavailable'/);
  assert.doesNotMatch(bootstrapSource, /setStatusBanner\(\{\s*kind:\s*'warning',\s*message,\s*\}\)/);
  assert.doesNotMatch(
    read('shell/renderer/mod-ui/lifecycle/runtime-mod-developer-host.ts'),
    /setStatusBanner\(/,
  );
});

test('runtime-config routes connector tests and page errors through inline feedback', () => {
  const connectorTestSource = read('shell/renderer/features/runtime-config/runtime-config-connector-test-command.ts');
  assert.match(connectorTestSource, /setControlFeedback\(/);
  assert.doesNotMatch(connectorTestSource, /setStatusBanner\(/);

  const panelViewSource = read('shell/renderer/features/runtime-config/runtime-config-panel-view.tsx');
  assert.match(panelViewSource, /<InlineFeedback/);
  assert.match(panelViewSource, /model\.pageFeedback/);
});

test('mods actions use page-context feedback instead of global banners', () => {
  const modHubSource = read('shell/renderer/features/mod-hub/mod-hub-controller.ts');
  assert.match(modHubSource, /setModsFeedback/);
  assert.doesNotMatch(modHubSource, /setStatusBanner\(\{/);

  const navSource = read('shell/renderer/app-shell/layouts/main-layout-view.tsx');
  assert.match(navSource, /modsHasIssues/);
  assert.match(navSource, /badge=\{modsHasIssues/);
});

test('phase-2 migrated surfaces no longer write global status banners directly', () => {
  const migratedSources = [
    'shell/renderer/features/contacts/contacts-panel.tsx',
    'shell/renderer/features/profile/profile-panel.tsx',
    'shell/renderer/features/notification/notification-panel.tsx',
    'shell/renderer/features/settings/settings-account-panel.tsx',
    'shell/renderer/features/settings/settings-security-page.tsx',
    'shell/renderer/features/settings/settings-developer-page.tsx',
    'shell/renderer/features/settings/settings-language-region-panel.tsx',
    'shell/renderer/features/settings/settings-data-management-page.tsx',
    'shell/renderer/features/turns/turn-input.tsx',
    'shell/renderer/features/chat/chat-human-canonical-components.tsx',
    'shell/renderer/features/agent-detail/agent-detail-panel.tsx',
    'shell/renderer/features/contacts/contact-detail-profile-modal.tsx',
    'shell/renderer/features/economy/gift-inbox-panel.tsx',
    'shell/renderer/features/economy/gift-message-bubble.tsx',
    'shell/renderer/features/home/post-card.tsx',
    'shell/renderer/features/home/use-post-card-ui.ts',
    'shell/renderer/features/chat/chat-ai-shell-adapter.tsx',
    'shell/renderer/features/chat/chat-agent-shell-adapter.tsx',
    'shell/renderer/features/world/world-detail.tsx',
    'shell/renderer/features/turns/human-conversation-gift-modal.tsx',
    'shell/renderer/mod-ui/host/slot-host.tsx',
  ];

  for (const source of migratedSources) {
    assert.doesNotMatch(read(source), /setStatusBanner\(/, source);
  }
});

test('notification audit report records final target channels for migrated phase-2 surfaces', () => {
  const report = readFileSync(resolve(import.meta.dirname, './fixtures/desktop-notification-audit.fixture.md'), 'utf8');
  assert.match(report, /slot-host\.tsx` render failed .* \| `page_inline` \(`Mods`\) \| migrated \|/);
  assert.match(report, /web-auth-menu\.tsx` auth warning\/error incl\. onboarding pending .* \| `page_inline` \| migrated \|/);
  assert.match(report, /turn-input\.tsx` upload\/send\/read-only\/unsupported-file .* \| `page_inline` \/ composer inline \| migrated \|/);
  assert.match(report, /## Remaining Whitelist/);
});

test('direct global status banner store access is limited to the explicit whitelist', () => {
  const rendererRoot = resolve(import.meta.dirname, '../src/shell/renderer');
  const directAccessPattern = /useAppStore\(\(state\) => state\.setStatusBanner\)|useAppStore\(\(s\) => s\.setStatusBanner\)|useAppStore\.getState\(\)\.setStatusBanner/;
  const whitelist = new Set([
    'shell/renderer/App.tsx',
    'shell/renderer/features/auth/logout.ts',
    'shell/renderer/infra/bootstrap/desktop-updates.ts',
    'shell/renderer/infra/bootstrap/runtime-bootstrap.ts',
    'shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities.ts',
    'shell/renderer/mod-ui/host/mod-tab-limit-banner.ts',
    'shell/renderer/ui/feedback/status-banner.tsx',
  ]);

  const offenders = collectSourceFiles(rendererRoot)
    .filter((absolute) => directAccessPattern.test(readFileSync(absolute, 'utf8')))
    .map((absolute) => relative(resolve(import.meta.dirname, '../src'), absolute).replace(/\\/g, '/'))
    .filter((file) => !whitelist.has(file));

  assert.deepEqual(offenders, []);
});
