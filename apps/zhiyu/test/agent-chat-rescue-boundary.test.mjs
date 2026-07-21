import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

test('primary agent chat surface excludes backstage and diagnostics drawer chrome', () => {
  const surface = read('src/shell/agent-chat/ZhiyuAgentChatSurface.tsx');

  assert.doesNotMatch(surface, /DeveloperBackstageSurface/);
  assert.doesNotMatch(surface, /diagnosticsOpen|setDiagnosticsOpen|zhiyu-home__diagnostics-layer/);
  assert.doesNotMatch(surface, /<RelationshipRail/);
});

test('home-surface css has no retired home-shell corrective layers', () => {
  const css = read('src/shell/app/home-surface.css');

  assert.doesNotMatch(css, /Product Design desktop migration|Desktop Agent Chat parity corrective layer|ZM15 product shell/);
  assert.doesNotMatch(css, /zhiyu-home__diagnostics-layer|zhiyu-home__diagnostics-drawer/);
});

test('agent chat css remains bounded and focused', () => {
  const css = read('src/shell/app/home-surface.css');
  const lines = css.split(/\r?\n/).filter((line) => line.trim()).length;

  assert.ok(lines <= 1000, `home-surface.css has ${lines} nonblank lines; keep agent chat CSS focused`);
  assert.doesNotMatch(css, /zhiyu-home__developer-backstage|zhiyu-home__proposal-intake/);
});

test('agent chat source no longer exposes retired backstage and home-shell surface names', () => {
  const sourceFiles = collectSourceFiles(path.join(root, 'src'));
  const retiredPaths = [
    'src/shell/app/home-developer-backstage.tsx',
    'src/shell/app/home-proposal-intake-section.tsx',
    'src/shell/app/home-capability-setup-section.tsx',
  ];
  const normalizedFiles = new Set(sourceFiles.map((file) => path.relative(root, file).replaceAll('\\', '/')));
  for (const retiredPath of retiredPaths) {
    assert.equal(normalizedFiles.has(retiredPath), false, `${retiredPath} must be removed from active source`);
  }

  const source = sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(
    source,
    /DeveloperBackstageSurface|ProposalIntakeSection|HomeCapabilitySetupSection|home-developer-backstage|home-proposal-intake-section|home-capability-setup-section/,
  );
  assert.doesNotMatch(source, /data-zhiyu-developer-backstage|developer-backstage|home-shell|home shell/i);
  assert.doesNotMatch(
    source,
    /zhiyu-home__developer-backstage|zhiyu-home__proposal-intake|zhiyu-home__developer-overview|zhiyu-home__developer-route-grid|zhiyu-home__agent-advanced-tab|zhiyu-home__advanced-warning|zhiyu-home__right-projections/,
  );
});

test('agent center does not keep retired local advanced styling hooks', () => {
  const css = read('src/shell/app/home-surface.css');

  assert.doesNotMatch(
    css,
    /zhiyu-agent-center__(capability-probe|proposal|advanced-warning|capability-studio|setup-hero|panel-row|kv-row)/,
  );
});

test('Agent Center UI classes do not use the retired home agent namespace', () => {
  const agentCenterSource = [
    read('src/shell/agent-chat/ZhiyuAgentRightPanel.tsx'),
    read('src/shell/agent-chat/ZhiyuAgentChatPieces.tsx'),
    read('src/production/agent-center-adapters.ts'),
    read('src/shell/app/home-surface.css'),
  ].join('\n');

  assert.doesNotMatch(agentCenterSource, /zhiyu-home__agent-/);
  assert.doesNotMatch(
    agentCenterSource,
    /zhiyu-home__(setup-hero|setup-meter|checklist-card|live-state-card|model-route-card|behavior-mode-card|cognition-source-card|panel-row|kv-row)/,
  );
  assert.doesNotMatch(agentCenterSource, /zhiyu-agent-center__(section|status|setup-hero|panel-row|kv-row)/);
  assert.match(agentCenterSource, /@nimiplatform\/kit\/features\/agent-center/);
  assert.match(agentCenterSource, /appearanceAdapter=\{props\.appearanceAdapter\}/);
  assert.match(agentCenterSource, /createAgentCenterShellAppearanceAdapter/);
});

function collectSourceFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(fullPath);
    }
    if (!entry.isFile() || !/\.(ts|tsx|css)$/.test(entry.name)) {
      return [];
    }
    assert.equal(statSync(fullPath).isFile(), true);
    return [fullPath];
  });
}
